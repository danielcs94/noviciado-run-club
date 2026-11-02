// API del Noviciado Run Club en un Cloudflare Worker con base de datos D1 (todo gratis).
//
// Pública:  GET  /events/next                 próximo evento (con aforo y rutas publicadas)
//           GET  /events/:slug
//           POST /events/:slug/signups        inscribirse (y hacerse socio la primera vez)
//           GET  /card/:code?k=…              tarjeta de socio
//           GET  /card/:code/google?k=…       enlace para añadirla a Google Wallet
// Admin:    POST /admin/login                 { password } → { token }
//           todo lo demás de /admin con "Authorization: Bearer <token>"
import { CHECKIN_POINTS, DISTANCES, GENDERS, INTENSITIES, MAX_EVENT_KM, MIN_KM, PACES, levelFor } from './club';
import { TEMPLATES, renderEmail, sendWithBrevo } from './email';
import { saveUrl, updatePass, walletEnabled } from './wallet';

interface Env {
  DB: D1Database;
  SITE_URL: string;
  ADMIN_PASSWORD: string;
  TOKEN_SECRET: string;
  BREVO_API_KEY?: string;
  MAIL_FROM_EMAIL?: string;
  MAIL_FROM_NAME?: string;
  GW_ISSUER_ID?: string;
  GW_SA_EMAIL?: string;
  GW_SA_KEY?: string;
}

interface EventRow {
  id: number; slug: string; title: string; starts_at: string; meeting_point: string;
  capacity: number; max_km: number; routes: string | null; routes_published_at: string | null;
}
interface MemberRow { id: number; code: string; secret: string; name: string; email: string; phone: string; gender: string | null; points: number }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

class HttpError extends Error {
  constructor(public status: number, message: string, public errors?: Record<string, string>) { super(message); }
}

const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    try {
      return await route(request, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { message: e.message, ...(e.errors ? { errors: e.errors } : {}) });
      console.error(e);
      return json(500, { message: 'Algo ha fallado en el servidor.' });
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const m = request.method;
  const at = (...p: string[]) => p.length === parts.length && p.every((x, i) => x === '*' || x === parts[i]);

  // ---------- Público ----------
  if (m === 'GET' && at('events', 'next')) return json(200, await publicEvent(env, await nextEvent(env)));
  if (m === 'GET' && at('events', '*')) return json(200, await publicEvent(env, await eventBySlug(env, parts[1])));
  if (m === 'POST' && at('events', '*', 'signups')) return signup(request, env, parts[1]);
  if (m === 'GET' && at('card', '*')) return json(200, cardView(await memberByCard(env, parts[1], url.searchParams.get('k')), env));
  if (m === 'GET' && at('card', '*', 'google')) {
    if (!walletEnabled(env)) throw new HttpError(501, 'Google Wallet aún no está configurado.');
    return json(200, { url: await saveUrl(env, await memberByCard(env, parts[1], url.searchParams.get('k'))) });
  }

  // ---------- Admin ----------
  if (parts[0] !== 'admin') throw new HttpError(404, 'No existe.');
  if (m === 'POST' && at('admin', 'login')) return login(request, env);
  await requireAdmin(request, env);

  if (m === 'GET' && at('admin', 'me')) return json(200, { ok: true, mail: Boolean(env.BREVO_API_KEY && env.MAIL_FROM_EMAIL), wallet: walletEnabled(env) });
  if (m === 'GET' && at('admin', 'events')) {
    const { results } = await env.DB.prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM signups s WHERE s.event_id = e.id AND s.walk_in = 0) AS booked
       FROM events e ORDER BY e.starts_at DESC`).all<EventRow & { booked: number }>();
    return json(200, results.map((e) => ({ ...eventFields(e), booked: e.booked, routes: e.routes ? JSON.parse(e.routes) : null })));
  }
  if (m === 'POST' && at('admin', 'events')) return createEvent(request, env);
  if (m === 'PATCH' && at('admin', 'events', '*')) return updateEvent(request, env, parts[2]);
  if (m === 'GET' && at('admin', 'events', '*', 'signups')) {
    const ev = await eventBySlug(env, parts[2]);
    const { results } = await env.DB.prepare(
      `SELECT s.id, s.pace, s.intensity, s.distance, s.walk_in, s.checked_in_at, s.last_emailed_at, s.created_at,
              m.name, m.email, m.phone, m.gender, m.code, m.points
       FROM signups s JOIN members m ON m.id = s.member_id WHERE s.event_id = ? ORDER BY s.created_at DESC`).bind(ev.id).all();
    return json(200, results);
  }
  if (m === 'PUT' && at('admin', 'events', '*', 'routes')) return publishRoutes(request, env, parts[2]);
  if (m === 'POST' && at('admin', 'events', '*', 'checkin')) return checkin(request, env, ctx, parts[2]);
  if (m === 'GET' && at('admin', 'emails', 'templates')) return json(200, TEMPLATES.map(({ key, name, description }) => ({ key, name, description })));
  if (m === 'GET' && at('admin', 'emails', 'preview')) {
    const rows = await mailRows(env, [Number(url.searchParams.get('signup_id'))]);
    const mail = rows[0] && renderEmail(url.searchParams.get('template') ?? '', mailContext(env, rows[0]));
    if (!mail) throw new HttpError(404, 'No existe esa plantilla o esa inscripción.');
    return json(200, mail);
  }
  if (m === 'POST' && at('admin', 'emails')) return sendEmails(request, env);

  throw new HttpError(404, 'No existe.');
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
function eventFields(e: EventRow) {
  return {
    slug: e.slug, title: e.title, starts_at: e.starts_at, meeting_point: e.meeting_point,
    capacity: e.capacity, max_km: e.max_km, routes_published_at: e.routes_published_at,
  };
}

async function nextEvent(env: Env) {
  // Sigue siendo "el próximo" hasta 12 h después de empezar (el post-run cuenta)
  const since = new Date(Date.now() - 12 * 3600e3).toISOString();
  const e = await env.DB.prepare('SELECT * FROM events WHERE starts_at >= ? ORDER BY starts_at LIMIT 1').bind(since).first<EventRow>();
  if (!e) throw new HttpError(404, 'No hay ningún evento anunciado.');
  return e;
}

async function eventBySlug(env: Env, slug: string) {
  const e = await env.DB.prepare('SELECT * FROM events WHERE slug = ?').bind(slug).first<EventRow>();
  if (!e) throw new HttpError(404, 'Ese evento no existe.');
  return e;
}

const bookedCount = async (env: Env, eventId: number) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM signups WHERE event_id = ? AND walk_in = 0').bind(eventId).first<number>('n')) ?? 0;

async function publicEvent(env: Env, e: EventRow) {
  const booked = await bookedCount(env, e.id);
  return {
    ...eventFields(e),
    booked,
    left: Math.max(0, e.capacity - booked),
    routes: e.routes ? JSON.parse(e.routes) : null,
    wallet: walletEnabled(env),
  };
}

function readEventInput(b: Record<string, unknown>, partial: boolean) {
  const errors: Record<string, string> = {};
  const out: Record<string, string | number> = {};
  const has = (k: string) => b[k] !== undefined;
  if (!partial || has('title')) {
    const t = String(b.title ?? '').trim();
    if (t.length < 3 || t.length > 80) errors.title = 'El título debe tener entre 3 y 80 caracteres.';
    out.title = t;
  }
  if (!partial || has('starts_at')) {
    const d = new Date(String(b.starts_at ?? ''));
    if (Number.isNaN(d.getTime())) errors.starts_at = 'La fecha no es válida.';
    else out.starts_at = d.toISOString();
  }
  if (!partial || has('meeting_point')) {
    const p = String(b.meeting_point ?? '').trim();
    if (p.length < 3 || p.length > 120) errors.meeting_point = 'Indica el punto de encuentro.';
    out.meeting_point = p;
  }
  if (!partial || has('capacity')) {
    const c = Number(b.capacity);
    if (!Number.isInteger(c) || c < 1 || c > 2000) errors.capacity = 'El aforo debe ser un número entre 1 y 2000.';
    out.capacity = c;
  }
  if (!partial || has('max_km')) {
    const k = Number(b.max_km);
    if (!(k >= MIN_KM && k <= MAX_EVENT_KM)) errors.max_km = `La distancia máxima debe estar entre ${MIN_KM} y ${MAX_EVENT_KM} km.`;
    out.max_km = Math.round(k * 10) / 10;
  }
  if (Object.keys(errors).length) throw new HttpError(422, Object.values(errors)[0], errors);
  return out;
}

async function createEvent(request: Request, env: Env) {
  const data = readEventInput(await body(request), false);
  const base = `${slugify(String(data.title))}-${String(data.starts_at).slice(0, 10).replace(/-/g, '')}`;
  let slug = base;
  for (let i = 2; await env.DB.prepare('SELECT 1 FROM events WHERE slug = ?').bind(slug).first(); i++) slug = `${base}-${i}`;
  await env.DB.prepare('INSERT INTO events (slug, title, starts_at, meeting_point, capacity, max_km) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(slug, data.title, data.starts_at, data.meeting_point, data.capacity, data.max_km).run();
  return json(201, eventFields(await eventBySlug(env, slug)));
}

async function updateEvent(request: Request, env: Env, slug: string) {
  const ev = await eventBySlug(env, slug);
  const data = readEventInput(await body(request), true);
  const keys = Object.keys(data);
  if (keys.length) {
    await env.DB.prepare(`UPDATE events SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .bind(...keys.map((k) => data[k]), ev.id).run();
  }
  return json(200, eventFields(await eventBySlug(env, slug)));
}

function slugify(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'evento';
}

// ---------------------------------------------------------------------------
// Rutas publicadas (las genera el panel de admin en el navegador)
// ---------------------------------------------------------------------------
async function publishRoutes(request: Request, env: Env, slug: string) {
  const ev = await eventBySlug(env, slug);
  const raw = await request.text();
  if (raw.length > 400_000) throw new HttpError(413, 'La ruta es demasiado grande.');
  const routes = (JSON.parse(raw || '{}') as { routes?: unknown }).routes;
  if (routes === null) {
    await env.DB.prepare('UPDATE events SET routes = NULL, routes_published_at = NULL WHERE id = ?').bind(ev.id).run();
    return json(200, { routes: null });
  }
  if (!Array.isArray(routes) || routes.length < 1 || routes.length > 2) throw new HttpError(422, 'Publica una o dos rutas.');
  for (const r of routes as Record<string, unknown>[]) {
    const coords = r?.coords;
    const km = Number(r?.km);
    if (!Array.isArray(coords) || coords.length < 2 || coords.length > 3000
      || !coords.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)))) {
      throw new HttpError(422, 'La ruta no tiene un trazado válido.');
    }
    if (!(km > 0 && km <= ev.max_km + 0.3)) throw new HttpError(422, `La ruta pasa del máximo del evento (${ev.max_km} km).`);
  }
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE events SET routes = ?, routes_published_at = ? WHERE id = ?').bind(JSON.stringify(routes), now, ev.id).run();
  return json(200, { routes, routes_published_at: now });
}

// ---------------------------------------------------------------------------
// Inscripción
// ---------------------------------------------------------------------------
async function signup(request: Request, env: Env, slug: string) {
  await rateLimit(env, `signup:${clientIp(request)}`, 10);
  const ev = await eventBySlug(env, slug);
  if (new Date(ev.starts_at).getTime() < Date.now()) throw new HttpError(409, 'Este evento ya ha empezado.');
  const b = await body(request);

  const errors: Record<string, string> = {};
  const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
  const email = String(b.email ?? '').trim().toLowerCase();
  const phone = String(b.phone ?? '').replace(/[\s\-().]/g, '');
  const gender = b.gender ? String(b.gender) : null;
  if (name.length < 3 || name.length > 80) errors.name = 'Escribe tu nombre y apellido.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) errors.email = 'Ese correo no parece válido.';
  if (!/^\+?\d{9,15}$/.test(phone)) errors.phone = 'El teléfono debe tener entre 9 y 15 cifras.';
  if (gender !== null && !(GENDERS as readonly string[]).includes(gender)) errors.gender = 'Elige una opción de la lista.';
  if (!(PACES as readonly string[]).includes(String(b.pace))) errors.pace = 'Elige tu ritmo.';
  if (!(INTENSITIES as readonly string[]).includes(String(b.intensity))) errors.intensity = 'Elige cómo de intensa quieres la ruta.';
  if (!(DISTANCES as readonly string[]).includes(String(b.distance))) errors.distance = 'Elige cuánto quieres correr.';
  if (b.terms !== true) errors.terms = 'Tienes que ser mayor de 18 y aceptar la política de privacidad.';
  if (Object.keys(errors).length) throw new HttpError(422, Object.values(errors)[0], errors);

  // Socio: si el correo ya existe se reutiliza su tarjeta (sin tocar sus datos, que podría no ser él)
  let member = await env.DB.prepare('SELECT * FROM members WHERE email = ?').bind(email).first<MemberRow>();
  const isNew = !member;
  if (!member) {
    for (let i = 0; i < 5 && !member; i++) {
      member = await env.DB.prepare(
        'INSERT INTO members (code, secret, name, email, phone, gender) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING *')
        .bind(newCode(), randomToken(18), name, email, phone, gender).first<MemberRow>();
      member ??= await env.DB.prepare('SELECT * FROM members WHERE email = ?').bind(email).first<MemberRow>();
    }
    if (!member) throw new HttpError(500, 'No se pudo crear tu tarjeta. Inténtalo de nuevo.');
  }

  // Inserta solo si queda aforo: la comprobación y el alta van en la misma sentencia
  let res: D1Result;
  try {
    res = await env.DB.prepare(
      `INSERT INTO signups (event_id, member_id, pace, intensity, distance)
       SELECT ?1, ?2, ?3, ?4, ?5 WHERE (SELECT COUNT(*) FROM signups WHERE event_id = ?1 AND walk_in = 0) < ?6`)
      .bind(ev.id, member.id, b.pace, b.intensity, b.distance, ev.capacity).run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new HttpError(422, 'Ya hay una inscripción con este correo.', { email: 'Ya hay una inscripción con este correo.' });
    throw e;
  }
  if (!res.meta.changes) throw new HttpError(409, 'Aforo completo.');

  const booked = await bookedCount(env, ev.id);
  return json(201, {
    name: member.name,
    email: member.email,
    code: member.code,
    points: member.points,
    level: levelFor(member.points).name,
    newMember: isNew,
    // El enlace a la tarjeta solo se da al crearla: si no, cualquiera que sepa tu correo la vería
    card: isNew ? { code: member.code, k: member.secret } : null,
    wallet: isNew && walletEnabled(env),
    booked,
    capacity: ev.capacity,
  });
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return 'NRC-' + [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
function randomToken(n: number) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Tarjeta de socio
// ---------------------------------------------------------------------------
async function memberByCard(env: Env, code: string, k: string | null) {
  const m = await env.DB.prepare('SELECT * FROM members WHERE code = ?').bind(code.toUpperCase()).first<MemberRow>();
  if (!m || !k || !(await safeEqual(m.secret, k, env))) throw new HttpError(404, 'Esta tarjeta no existe.');
  return m;
}

function cardView(m: MemberRow, env: Env) {
  const level = levelFor(m.points);
  return {
    name: m.name, code: m.code, points: m.points,
    level: level.name, levelKey: level.key,
    next: level.next ? { name: level.next.name, from: level.next.from } : null,
    wallet: walletEnabled(env),
  };
}

async function checkin(request: Request, env: Env, ctx: ExecutionContext, slug: string) {
  const ev = await eventBySlug(env, slug);
  const code = String((await body(request)).code ?? '').trim().toUpperCase().replace(/^NRC-?/, 'NRC-');
  const m = await env.DB.prepare('SELECT * FROM members WHERE code = ?').bind(code).first<MemberRow>();
  if (!m) throw new HttpError(404, `No hay ningún socio con el código ${code || '(vacío)'}.`);

  let s = await env.DB.prepare('SELECT * FROM signups WHERE event_id = ? AND member_id = ?').bind(ev.id, m.id).first<{ id: number; checked_in_at: string | null }>();
  if (s?.checked_in_at) {
    return json(200, { already: true, name: m.name, code: m.code, points: m.points, level: levelFor(m.points).name, walkIn: false });
  }
  const now = new Date().toISOString();
  const walkIn = !s;
  if (s) await env.DB.prepare('UPDATE signups SET checked_in_at = ? WHERE id = ?').bind(now, s.id).run();
  else await env.DB.prepare('INSERT INTO signups (event_id, member_id, walk_in, checked_in_at) VALUES (?, ?, 1, ?)').bind(ev.id, m.id, now).run();
  const updated = await env.DB.prepare('UPDATE members SET points = points + ? WHERE id = ? RETURNING *').bind(CHECKIN_POINTS, m.id).first<MemberRow>();
  ctx.waitUntil(updatePass(env, updated!).catch((e) => console.warn('Google Wallet', e)));
  const before = levelFor(m.points), after = levelFor(updated!.points);
  return json(200, {
    already: false, name: m.name, code: m.code, points: updated!.points, level: after.name,
    levelUp: after.key !== before.key, walkIn, added: CHECKIN_POINTS,
  });
}

// ---------------------------------------------------------------------------
// Correos
// ---------------------------------------------------------------------------
interface MailRow { id: number; name: string; email: string; code: string; secret: string; title: string; starts_at: string; meeting_point: string }

async function mailRows(env: Env, ids: number[]) {
  if (!ids.length || ids.some((n) => !Number.isInteger(n))) return [];
  const { results } = await env.DB.prepare(
    `SELECT s.id, m.name, m.email, m.code, m.secret, e.title, e.starts_at, e.meeting_point
     FROM signups s JOIN members m ON m.id = s.member_id JOIN events e ON e.id = s.event_id
     WHERE s.id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<MailRow>();
  return results;
}

const mailContext = (env: Env, r: MailRow) => ({
  name: r.name, email: r.email, code: r.code,
  cardUrl: `${env.SITE_URL}tarjeta.html?c=${r.code}&k=${r.secret}`,
  event: { title: r.title, starts_at: r.starts_at, meeting_point: r.meeting_point },
});

async function sendEmails(request: Request, env: Env) {
  if (!env.BREVO_API_KEY || !env.MAIL_FROM_EMAIL) throw new HttpError(503, 'El envío de correos aún no está configurado (falta Brevo).');
  const b = await body(request);
  const ids = Array.isArray(b.signup_ids) ? b.signup_ids.map(Number) : [];
  // El plan gratuito de Workers permite 50 peticiones salientes por llamada: el panel manda tandas de 40
  if (!ids.length || ids.length > 40) throw new HttpError(422, 'Envía entre 1 y 40 correos por tanda.');
  const sent: number[] = [], failed: string[] = [];
  for (const r of await mailRows(env, ids)) {
    const mail = renderEmail(String(b.template), mailContext(env, r));
    if (!mail) throw new HttpError(422, 'Esa plantilla no existe.');
    try {
      await sendWithBrevo(env.BREVO_API_KEY, { email: env.MAIL_FROM_EMAIL, name: env.MAIL_FROM_NAME || 'Noviciado Run Club' }, { email: r.email, name: r.name }, mail);
      sent.push(r.id);
    } catch {
      failed.push(r.email);
    }
  }
  if (sent.length) {
    await env.DB.prepare(`UPDATE signups SET last_emailed_at = ? WHERE id IN (${sent.map(() => '?').join(',')})`)
      .bind(new Date().toISOString(), ...sent).run();
  }
  return json(200, { sent: sent.length, failed });
}

// ---------------------------------------------------------------------------
// Sesión de admin: un token firmado con caducidad, sin tabla de sesiones
// ---------------------------------------------------------------------------
const SESSION_DAYS = 30;

async function hmac(env: Env, data: string) {
  if (!env.TOKEN_SECRET) throw new HttpError(500, 'Falta TOKEN_SECRET en la configuración del servidor.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compara sin filtrar por tiempo cuántos caracteres coinciden
async function safeEqual(a: string, b: string, env: Env) {
  const [x, y] = await Promise.all([hmac(env, `cmp:${a}`), hmac(env, `cmp:${b}`)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function login(request: Request, env: Env) {
  await rateLimit(env, `login:${clientIp(request)}`, 5);
  if (!env.ADMIN_PASSWORD) throw new HttpError(500, 'Falta ADMIN_PASSWORD en la configuración del servidor.');
  const password = String((await body(request)).password ?? '');
  if (!(await safeEqual(password, env.ADMIN_PASSWORD, env))) throw new HttpError(422, 'Contraseña incorrecta.');
  const exp = Date.now() + SESSION_DAYS * 86400e3;
  return json(200, { token: `${exp}.${await hmac(env, `admin.${exp}`)}` });
}

async function requireAdmin(request: Request, env: Env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now() || !(await safeEqual(sig, await hmac(env, `admin.${exp}`), env))) {
    throw new HttpError(401, 'Tienes que entrar como administrador.');
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
async function body(request: Request): Promise<Record<string, unknown>> {
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'La petición no es válida.');
  return b as Record<string, unknown>;
}

const clientIp = (request: Request) => request.headers.get('CF-Connecting-IP') ?? 'local';

async function rateLimit(env: Env, key: string, perMinute: number) {
  const now = Date.now();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM hits WHERE key = ? AND at > ?').bind(key, now - 60_000).first<number>('n');
  if ((n ?? 0) >= perMinute) throw new HttpError(429, 'Demasiados intentos. Espera un minuto.');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO hits (key, at) VALUES (?, ?)').bind(key, now),
    env.DB.prepare('DELETE FROM hits WHERE at < ?').bind(now - 3600_000),
  ]);
}
