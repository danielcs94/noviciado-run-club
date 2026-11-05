// Panel de administración del run club, dentro de la misma app (botón de cuenta o #admin).
// Pestañas: Inscritos (y correos), Ruta (votos + generador), Fichar (tarjetas de socio) y Evento.
import { API, esc, fmtDate } from "./config.js";
import { CHECKIN_POINTS, GENDERS, INTENSITIES, PACES, distanceOptions } from "./club.js";
import { mountRouteTab, renderRouteTab } from "./admin-route.js";
import { mountCheckinTab, renderCheckinTab, stopScanner } from "./admin-checkin.js";
import { memberToken, openAccount } from "./account.js";

const TOKEN_KEY = "nrc:admin-token";
const PACE_COLORS = { tranquilo: "#f3dca0", medio: "#d9b56a", rapido: "#9c7a3c" };

export const state = {
  token: readToken(),
  config: { mail: false, wallet: false },
  events: [],
  event: null,
  signups: [],
  templates: [],
  query: "",
  pace: "all",
  tab: "people",
  selected: new Set(),
};

export const $ = (sel, root = document) => root.querySelector(sel);

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function saveToken(token) {
  state.token = token;
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch {}
}

export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API}/admin${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
    });
  } catch {
    throw Object.assign(new Error("No hemos podido conectar con el servidor."), { status: 0 });
  }
  if (res.status === 401 && path !== "/login") {
    saveToken(null);
    leaveAdmin();
    openLogin("Tu sesión ha caducado. Vuelve a entrar.");
    throw new Error("unauthorized");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(body?.message ?? "Error"), { status: res.status, body });
  return body;
}

// ---------- Marcado ----------
const icons = {
  user: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  logout: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>',
  public: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 5l-7 7 7 7"/></svg>',
};

function mount() {
  const pill = $(".topbar .pill");
  const right = document.createElement("div");
  right.className = "topbar-right";
  pill.replaceWith(right);
  right.append(pill, $("#my-card"));
  right.insertAdjacentHTML("beforeend", `<button class="account-btn" type="button" id="account-btn" aria-label="Tu cuenta">${icons.user}</button>`);

  document.body.insertAdjacentHTML("beforeend", `
    <section id="admin" aria-label="Panel de administración">
      <div class="admin">
        <header class="admin-head">
          <div>
            <span class="eyebrow">Panel · Run Club</span>
            <h1 class="gold-text" id="admin-hello">Panel</h1>
          </div>
          <div class="admin-head-actions">
            <select class="select" id="admin-event" aria-label="Evento"></select>
            <button class="btn-ghost" type="button" id="admin-public">${icons.public} Web</button>
            <button class="btn-ghost" type="button" id="admin-logout">${icons.logout} Salir</button>
          </div>
        </header>

        <nav class="admin-tabs" id="admin-tabs" role="tablist">
          <button type="button" role="tab" data-tab="people" aria-selected="true">Inscritos</button>
          <button type="button" role="tab" data-tab="route" aria-selected="false">Ruta</button>
          <button type="button" role="tab" data-tab="checkin" aria-selected="false">Fichar</button>
          <button type="button" role="tab" data-tab="event" aria-selected="false">Evento</button>
        </nav>

        <div class="admin-panel" data-panel="people">
          <div class="stats" id="admin-stats"></div>
          <div class="charts">
            <section class="card chart-card">
              <span class="eyebrow">Últimos 14 días</span>
              <h2>Inscripciones por día</h2>
              <div class="daily" id="admin-daily" role="img"></div>
            </section>
            <section class="card chart-card">
              <span class="eyebrow">Grupos</span>
              <h2>Ritmos</h2>
              <div class="paces" id="admin-paces"></div>
              <p class="chart-note" id="admin-genders"></p>
            </section>
          </div>

          <section class="card people">
            <div class="people-head">
              <div>
                <span class="eyebrow">Inscritos</span>
                <h2 id="admin-people-title">Gente que se une</h2>
              </div>
              <div class="toolbar">
                <label class="search">${icons.search}<input type="search" id="admin-search" placeholder="Buscar por nombre, correo o código" autocomplete="off"></label>
                <div class="filter-chips" id="admin-filter">
                  <button type="button" data-pace="all" aria-pressed="true">Todos</button>
                  ${Object.entries(PACES).map(([k, p]) => `<button type="button" data-pace="${k}" aria-pressed="false">${p.label}</button>`).join("")}
                </div>
                <button class="btn-ghost" type="button" id="admin-csv">${icons.download} CSV</button>
              </div>
            </div>
            <div class="list-head">
              <input class="tick" type="checkbox" id="admin-all" aria-label="Seleccionar todos">
              <span>Persona</span>
              <span class="col-md">Teléfono</span>
              <span class="col-md">Ritmo</span>
              <span class="col-md">Ruta votada</span>
              <span class="col-md">Se unió</span>
              <span class="col-md">Estado</span>
            </div>
            <div id="admin-list"></div>
          </section>
        </div>

        <div class="admin-panel" data-panel="route" hidden></div>
        <div class="admin-panel" data-panel="checkin" hidden></div>

        <div class="admin-panel" data-panel="event" hidden>
          <section class="card section event-form-card">
            <div class="section-head">
              <div>
                <span class="eyebrow" id="event-form-eyebrow">Evento</span>
                <h2 id="event-form-title">Editar evento</h2>
              </div>
              <button class="btn-ghost" type="button" id="event-new">+ Nuevo evento</button>
            </div>
            <form id="event-form" class="event-form" novalidate>
              <div class="field wide"><input id="ev-f-title" name="title" placeholder=" " required maxlength="80"><label for="ev-f-title">Título</label></div>
              <div class="field"><input id="ev-f-date" name="date" type="date" placeholder=" " required><label for="ev-f-date">Día</label></div>
              <div class="field"><input id="ev-f-time" name="time" type="time" placeholder=" " required><label for="ev-f-time">Hora de salida</label></div>
              <div class="field wide"><input id="ev-f-place" name="meeting_point" placeholder=" " required maxlength="120"><label for="ev-f-place">Punto de encuentro</label></div>
              <div class="field"><input id="ev-f-cap" name="capacity" type="number" min="1" max="2000" placeholder=" " required><label for="ev-f-cap">Aforo</label></div>
              <div class="field"><input id="ev-f-km" name="max_km" type="number" min="3" max="15" step="0.5" placeholder=" " required><label for="ev-f-km">Distancia máxima (km)</label></div>
              <div class="field"><input id="ev-f-cdate" name="close_date" type="date" placeholder=" " required><label for="ev-f-cdate">Cierre de la votación</label></div>
              <div class="field"><input id="ev-f-ctime" name="close_time" type="time" placeholder=" " required><label for="ev-f-ctime">Hora de cierre</label></div>
              <p class="form-error wide" id="event-error" role="alert" hidden></p>
              <button class="btn-gold wide" type="submit" id="event-save">Guardar</button>
            </form>
            <div class="danger-zone" id="event-danger">
              <div><b>Eliminar este evento</b><small>Se borran el evento, su ruta y sus inscripciones. Los socios conservan su tarjeta y sus puntos.</small></div>
              <button class="btn-danger" type="button" id="event-delete">Eliminar evento</button>
            </div>
            <p class="note" style="text-align:left;margin-top:16px">La web siempre muestra el próximo evento. La distancia máxima marca los tramos del cuestionario y el límite del generador de rutas. Hasta el cierre de la votación la gente vota la ruta; después solo se inscribe, para que te dé tiempo a publicarla (por defecto, dos días antes a las 23:59). Publicar la ruta también cierra la votación.</p>
          </section>
        </div>
      </div>
    </section>

    <div class="select-bar" id="admin-select-bar">
      <span><b id="admin-sel-count">0</b><span class="sel-word"> seleccionados</span></span>
      <div class="actions">
        <button class="link-btn" type="button" id="admin-sel-clear">Quitar</button>
        <button class="btn-danger" type="button" id="admin-sel-delete">Eliminar</button>
        <button class="btn-gold" type="button" id="admin-sel-mail">Enviar correo</button>
      </div>
    </div>

    <div class="modal" id="login-modal" aria-hidden="true">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <div class="sheet-head">
          <div>
            <span class="eyebrow">Administración</span>
            <h3 id="login-title">Entrar al panel</h3>
          </div>
          <button class="close" type="button" data-close-login aria-label="Cerrar">×</button>
        </div>
        <form id="login-form" novalidate>
          <input type="text" name="username" value="admin" autocomplete="username" hidden>
          <div class="field">
            <input id="login-password" name="password" type="password" autocomplete="current-password" placeholder=" " required>
            <label for="login-password">Contraseña</label>
          </div>
          <p class="form-error" id="login-error" role="alert" hidden></p>
          <button class="btn-gold btn-block" type="submit" id="login-submit">Entrar</button>
        </form>
      </div>
    </div>

    <div class="modal" id="mail-modal" aria-hidden="true">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mail-title">
        <div class="sheet-head">
          <div>
            <span class="eyebrow">Correo</span>
            <h3 id="mail-title">Enviar a <span id="mail-count">0</span></h3>
          </div>
          <button class="close" type="button" data-close-mail aria-label="Cerrar">×</button>
        </div>
        <p class="recipients" id="mail-recipients"></p>
        <span class="eyebrow group-label">Plantilla</span>
        <div class="templates" id="mail-templates" style="margin-top:8px"></div>
        <div class="preview-label eyebrow"><span>Vista previa</span><span id="mail-preview-who"></span></div>
        <iframe class="preview" id="mail-preview" title="Vista previa del correo" sandbox></iframe>
        <p class="subject">Asunto: <b id="mail-subject">…</b></p>
        <p class="form-error" id="mail-error" role="alert" hidden></p>
        <button class="btn-gold btn-block" type="button" id="mail-send">Enviar</button>
      </div>
    </div>

    <div class="toast" id="admin-toast" role="status"></div>
  `);
  mountRouteTab($('[data-panel="route"]'));
  mountCheckinTab($('[data-panel="checkin"]'));
  $('[data-panel="checkin"]').insertAdjacentHTML("beforeend", `
    <section class="card section reset-card">
      <span class="eyebrow">Cuentas de socio</span>
      <h2>Contraseña nueva</h2>
      <p class="note" style="text-align:left">Para quien la haya olvidado o se hizo socio antes de que hubiera cuentas. Escribe su código o su correo, genera una contraseña y díctasela: entra con ella y la cambia desde su cuenta.</p>
      <form id="reset-form" class="reset-form" novalidate>
        <div class="field"><input id="reset-who" placeholder=" " autocomplete="off" required><label for="reset-who">Código (NRC-…) o correo</label></div>
        <button class="btn-gold" type="submit" id="reset-submit">Generar</button>
      </form>
      <div class="reset-result" id="reset-result" hidden></div>
    </section>`);
}

// ---------- Navegación ----------
function openModal(el) {
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function closeModal(el) {
  el.classList.remove("open");
  el.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function openLogin(message = "") {
  showFormError($("#login-error"), message);
  openModal($("#login-modal"));
  setTimeout(() => $("#login-password").focus(), 250);
}

async function enterAdmin() {
  document.body.classList.add("is-admin");
  if (location.hash !== "#admin") history.replaceState(null, "", "#admin");
  window.scrollTo(0, 0);
  try {
    const [config, events, templates] = await Promise.all([api("/me"), api("/events"), api("/emails/templates")]);
    state.config = config;
    // Sin Brevo no se puede enviar nada: el botón aparece cuando el correo esté configurado
    $("#admin-sel-mail").hidden = !config.mail;
    state.templates = templates;
    state.events = events;
    renderEventSelect();
    // Por defecto, el próximo evento (el más cercano que no ha pasado); si no, el último
    const upcoming = [...events].reverse().find((e) => new Date(e.starts_at) > Date.now() - 12 * 3600e3);
    const slug = state.event?.slug ?? (upcoming ?? events[0])?.slug;
    if (slug) await selectEvent(slug);
    else { state.event = null; render(); showTab("event"); fillEventForm(null); }
  } catch (e) {
    if (e.message !== "unauthorized") toast(e.status === 0 ? "No se pudo conectar con la API. ¿Está arrancada?" : e.message, "err");
  }
}

function leaveAdmin() {
  document.body.classList.remove("is-admin");
  $("#admin-select-bar").classList.remove("show");
  stopScanner();
  if (location.hash === "#admin") history.replaceState(null, "", location.pathname);
}

function renderEventSelect() {
  $("#admin-event").innerHTML = state.events.map((e) =>
    `<option value="${esc(e.slug)}">${esc(e.title)} · ${esc(fmtDate(e.starts_at, { day: "numeric", month: "short" }))}</option>`).join("");
  $("#admin-event").hidden = state.events.length < 2;
}

export async function selectEvent(slug) {
  state.event = state.events.find((e) => e.slug === slug);
  $("#admin-event").value = slug;
  state.selected.clear();
  await reloadSignups();
  fillEventForm(state.event);
}

export async function reloadSignups() {
  state.signups = state.event ? await api(`/events/${encodeURIComponent(state.event.slug)}/signups`) : [];
  render();
}

export async function reloadEvents() {
  state.events = await api("/events");
  if (state.event) state.event = state.events.find((e) => e.slug === state.event.slug) ?? state.event;
  renderEventSelect();
  if (state.event) $("#admin-event").value = state.event.slug;
}

function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll("#admin-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  document.querySelectorAll(".admin-panel").forEach((p) => (p.hidden = p.dataset.panel !== tab));
  $("#admin-select-bar").classList.toggle("show", tab === "people" && state.selected.size > 0);
  if (tab !== "checkin") stopScanner();
  if (tab === "route") renderRouteTab();
  if (tab === "checkin") renderCheckinTab();
}

// ---------- Pintado ----------
export function render() {
  $("#admin-hello").textContent = state.event ? state.event.title : "Sin eventos";
  if (!state.event) {
    $("#admin-stats").innerHTML = "";
    $("#admin-list").innerHTML = `<div class="empty"><b>No hay eventos</b>Crea el primero en la pestaña Evento.</div>`;
    return;
  }
  renderStats();
  renderDaily();
  renderPaces();
  renderList();
  if (state.tab === "route") renderRouteTab();
  if (state.tab === "checkin") renderCheckinTab();
}

const booked = () => state.signups.filter((s) => !s.walk_in);

function renderStats() {
  const e = state.event;
  const n = booked().length;
  const left = Math.max(0, e.capacity - n);
  const day = Date.now() - 24 * 3600e3;
  const recent = booked().filter((s) => new Date(s.created_at) > day).length;
  const checked = state.signups.filter((s) => s.checked_in_at).length;
  const date = fmtDate(e.starts_at, { weekday: "long", day: "numeric", month: "long" });

  $("#admin-stats").innerHTML = `
    <div class="card stat">
      <span class="eyebrow">Inscritos</span>
      <b class="gold-text">${n}</b>
      <div class="bar"><i style="width:${Math.min(100, (n / e.capacity) * 100)}%"></i></div>
      <small>de ${e.capacity} plazas</small>
    </div>
    <div class="card stat">
      <span class="eyebrow">Plazas libres</span>
      <b>${left}</b>
      <small>${esc(date)}</small>
    </div>
    <div class="card stat">
      <span class="eyebrow">Últimas 24 h</span>
      <b>${recent > 0 ? "+" : ""}${recent}</b>
      <small>${recent === 1 ? "nueva inscripción" : "nuevas inscripciones"}</small>
    </div>
    <div class="card stat">
      <span class="eyebrow">Fichados</span>
      <b>${checked}</b>
      <small>${state.signups.length - n ? `${state.signups.length - n} sin apuntarse antes` : "en la puerta"}</small>
    </div>`;
}

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function renderDaily() {
  const days = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    days.push({ date: d, key: dayKey(d), count: 0 });
  }
  const byKey = Object.fromEntries(days.map((d) => [d.key, d]));
  booked().forEach((s) => {
    const day = byKey[dayKey(new Date(s.created_at))];
    if (day) day.count++;
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((n, d) => n + d.count, 0);
  const el = $("#admin-daily");
  el.setAttribute("aria-label", `${total} inscripciones en los últimos 14 días`);
  el.innerHTML = days.map((d, i) => {
    const short = d.date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    const showLabel = i === 0 || i === 6 || i === 13;
    return `<div class="day ${d.count ? "" : "zero"} ${showLabel ? "label" : ""}">
      <span class="tip">${d.count} ${d.count === 1 ? "inscripción" : "inscripciones"} · ${short}</span>
      <i style="height:${d.count ? Math.max(4, (d.count / max) * 100) : 1.5}%"></i>
      <span>${i === 13 ? "Hoy" : short}</span>
    </div>`;
  }).join("");
}

function renderPaces() {
  const list = booked();
  const total = list.length;
  $("#admin-paces").innerHTML = Object.entries(PACES).map(([key, p]) => {
    const n = list.filter((s) => s.pace === key).length;
    const pct = total ? Math.round((n / total) * 100) : 0;
    return `<div class="pace-row">
      <header><b>${p.label}</b><span>${n} · ${pct}%</span></header>
      <div class="pace-track"><i style="width:${pct}%; background:${PACE_COLORS[key]}"></i></div>
    </div>`;
  }).join("");
  const g = Object.entries(GENDERS).map(([k, v]) => `${v}: ${list.filter((s) => s.gender === k).length}`);
  g.push(`Sin indicar: ${list.filter((s) => !s.gender).length}`);
  $("#admin-genders").textContent = total ? g.join(" · ") : "";
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.signups.filter((s) =>
    (state.pace === "all" || s.pace === state.pace) &&
    (!q || [s.name, s.email, s.code, s.phone].some((v) => String(v).toLowerCase().includes(q))));
}

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

function relative(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return days === 1 ? "ayer" : `hace ${days} días`;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

const phone = (p) => p.replace(/^(\+\d{2})?(\d{3})(\d{3})(\d{3})$/, (_, c, a, b, d) => `${c ? c + " " : ""}${a} ${b} ${d}`);

function voteText(s) {
  if (s.walk_in) return "Sin inscripción";
  if (!s.distance) return "Tras el cierre";
  const d = distanceOptions(state.event.max_km)[s.distance];
  return `${INTENSITIES[s.intensity]?.label ?? "—"} · ${d ? d.label : "—"}`;
}

function statusBadge(s) {
  if (s.checked_in_at) return `<span class="mail-state sent" title="Fichado ${esc(fmtDate(s.checked_in_at, { hour: "2-digit", minute: "2-digit" }))}">Fichado</span>`;
  if (s.last_emailed_at) return `<span class="mail-state sent" title="${esc(new Date(s.last_emailed_at).toLocaleString("es-ES"))}">Correo enviado</span>`;
  return `<span class="mail-state">Pendiente</span>`;
}

function renderList() {
  const rows = filtered();
  $("#admin-people-title").textContent = rows.length === state.signups.length ? `Gente que se une · ${rows.length}` : `${rows.length} de ${state.signups.length}`;
  if (!state.signups.length) {
    $("#admin-list").innerHTML = `<div class="empty"><b>Aún no hay nadie</b>Cuando alguien reserve plaza aparecerá aquí.</div>`;
  } else if (!rows.length) {
    $("#admin-list").innerHTML = `<div class="empty"><b>Sin resultados</b>Prueba con otra búsqueda o quita el filtro.</div>`;
  } else {
    $("#admin-list").innerHTML = rows.map((s) => {
      const sel = state.selected.has(s.id);
      const pace = PACES[s.pace]?.label ?? "—";
      const paceBadge = s.pace ? `<span class="badge ${esc(s.pace)}">${esc(pace)}</span>` : "";
      return `<div class="person ${sel ? "selected" : ""}" data-id="${s.id}">
        <input class="tick" type="checkbox" ${sel ? "checked" : ""} aria-label="Seleccionar a ${esc(s.name)}">
        <div class="who">
          <span class="avatar" aria-hidden="true">${esc(initials(s.name))}</span>
          <div>
            <b>${esc(s.name)}</b>
            <small>${esc(s.email)} · <code>${esc(s.code)}</code></small>
            <div class="person-meta">${paceBadge}${statusBadge(s)}</div>
          </div>
        </div>
        <span class="cell muted md">${esc(phone(s.phone))}</span>
        <span class="cell md">${paceBadge || "—"}</span>
        <span class="cell muted md">${esc(voteText(s))}</span>
        <span class="cell muted md">${relative(s.created_at)}</span>
        <span class="cell md">${statusBadge(s)}</span>
        <span class="cell muted" style="font-size:12px" data-mobile-only>${relative(s.created_at)}</span>
      </div>`;
    }).join("");
  }
  renderSelection();
}

function renderSelection() {
  const visible = filtered().map((s) => s.id);
  const chosen = visible.filter((id) => state.selected.has(id)).length;
  const all = $("#admin-all");
  all.checked = visible.length > 0 && chosen === visible.length;
  all.indeterminate = chosen > 0 && chosen < visible.length;
  $("#admin-sel-count").textContent = state.selected.size;
  $("#admin-select-bar").classList.toggle("show", state.tab === "people" && state.selected.size > 0);
}

// ---------- Eliminar inscripciones ----------
async function deleteSelected() {
  const rows = state.signups.filter((s) => state.selected.has(s.id));
  if (!rows.length) return;
  const checked = rows.filter((s) => s.checked_in_at).length;
  const who = rows.length === 1 ? rows[0].name : `${rows.length} personas`;
  const msg = `¿Quitar a ${who} de «${state.event.title}»?\n\nSe libera su plaza. Siguen siendo socios con su cuenta y su tarjeta.`
    + (checked ? `\n\n${checked === 1 && rows.length === 1 ? "Ya había fichado" : `${checked} ya habían fichado`}: se les restan los ${CHECKIN_POINTS} puntos de esta carrera.` : "");
  if (!confirm(msg)) return;
  const btn = $("#admin-sel-delete");
  btn.disabled = true;
  try {
    const r = await api(`/events/${encodeURIComponent(state.event.slug)}/signups/delete`, { method: "POST", body: JSON.stringify({ ids: rows.map((s) => s.id) }) });
    state.selected.clear();
    await Promise.all([reloadSignups(), reloadEvents()]);
    toast(r.deleted === 1 ? "Inscripción eliminada" : `${r.deleted} inscripciones eliminadas`);
  } catch (e) {
    if (e.message !== "unauthorized") toast(e.message, "err");
  } finally {
    btn.disabled = false;
  }
}

// ---------- Correo ----------
function openMail() {
  const people = state.signups.filter((s) => state.selected.has(s.id));
  if (!people.length) return;
  $("#mail-count").textContent = people.length === 1 ? "1 persona" : `${people.length} personas`;
  const names = people.map((p) => p.name.split(" ")[0]);
  $("#mail-recipients").textContent = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} y ${names.length - 3} más`;
  $("#mail-templates").innerHTML = state.templates.map((t, i) => `
    <label class="template"><input type="radio" name="template" value="${esc(t.key)}" ${i === 0 ? "checked" : ""}>
      <span><b>${esc(t.name)}</b><small>${esc(t.description)}</small></span></label>`).join("");
  showFormError($("#mail-error"), state.config.mail ? "" : "El envío aún no está configurado: puedes ver la vista previa, pero no enviar. Mira el README (Brevo).");
  $("#mail-send").disabled = !state.templates.length || !state.config.mail;
  $("#mail-send").textContent = people.length === 1 ? "Enviar a 1 persona" : `Enviar a ${people.length} personas`;
  openModal($("#mail-modal"));
  loadPreview();
}

async function loadPreview() {
  const template = $("#mail-templates input:checked")?.value;
  const first = state.signups.find((s) => state.selected.has(s.id));
  if (!template || !first) return;
  $("#mail-preview-who").textContent = `como la verá ${first.name.split(" ")[0]}`;
  try {
    const { subject, html } = await api(`/emails/preview?template=${encodeURIComponent(template)}&signup_id=${first.id}`);
    $("#mail-subject").textContent = subject;
    $("#mail-preview").srcdoc = html;
  } catch {
    $("#mail-subject").textContent = "No se pudo cargar la vista previa";
  }
}

async function sendMail() {
  const template = $("#mail-templates input:checked")?.value;
  const ids = [...state.selected];
  const btn = $("#mail-send");
  btn.disabled = true;
  showFormError($("#mail-error"), "");
  let sent = 0;
  const failed = [];
  try {
    // Tandas de 40: el límite del plan gratuito de Workers
    for (let i = 0; i < ids.length; i += 40) {
      btn.textContent = `Enviando… ${Math.min(i + 40, ids.length)}/${ids.length}`;
      const r = await api("/emails", { method: "POST", body: JSON.stringify({ template, signup_ids: ids.slice(i, i + 40) }) });
      sent += r.sent;
      failed.push(...r.failed);
    }
    closeModal($("#mail-modal"));
    state.selected.clear();
    await reloadSignups();
    toast(failed.length ? `Enviados ${sent}. Fallaron ${failed.length}: ${failed.join(", ")}` : `Correo enviado a ${sent} ${sent === 1 ? "persona" : "personas"}`, failed.length ? "err" : "ok");
  } catch (e) {
    if (e.message !== "unauthorized") showFormError($("#mail-error"), sent ? `Se enviaron ${sent} y luego falló: ${e.message}` : e.message);
    btn.disabled = false;
    btn.textContent = ids.length === 1 ? "Enviar a 1 persona" : `Enviar a ${ids.length} personas`;
  }
}

// ---------- Evento (crear y editar) ----------
let editing = null; // slug del evento que se edita, o null si es nuevo

function fillEventForm(e) {
  editing = e?.slug ?? null;
  $("#event-form-title").textContent = e ? "Editar evento" : "Nuevo evento";
  $("#event-form-eyebrow").textContent = e ? esc(e.title) : "Evento";
  $("#event-new").hidden = !e;
  $("#event-danger").hidden = !e;
  const f = $("#event-form");
  if (e) {
    const start = madridParts(e.starts_at), close = madridParts(e.votes_close_at);
    f.title.value = e.title;
    f.date.value = start.date;
    f.time.value = start.time;
    f.meeting_point.value = e.meeting_point;
    f.capacity.value = e.capacity;
    f.max_km.value = e.max_km;
    f.close_date.value = close.date;
    f.close_time.value = close.time;
    closeTouched = true;
  } else {
    f.reset();
    f.time.value = "09:30";
    f.meeting_point.value = "Noviciado Coffee Shop, calle del Noviciado 9, Madrid";
    f.capacity.value = 60;
    f.max_km.value = 10;
    f.close_time.value = "23:59";
    closeTouched = false;
  }
  showFormError($("#event-error"), "");
}

// Fecha y hora de Madrid para los campos (que trabajan en hora local del navegador)
function madridParts(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// En un evento nuevo, el cierre sigue a la fecha (dos días antes) hasta que lo cambias a mano
let closeTouched = false;
function suggestClose() {
  const f = $("#event-form");
  if (closeTouched || !f.date.value) return;
  const d = new Date(`${f.date.value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 2);
  f.close_date.value = d.toISOString().slice(0, 10);
  f.close_time.value = "23:59";
}

// Convierte día + hora de Madrid a ISO en UTC, sin depender de la zona del navegador
function madridToIso(date, time) {
  const guess = new Date(`${date}T${time}:00Z`);
  const madrid = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (madrid - utc)).toISOString();
}

async function saveEvent(ev) {
  ev.preventDefault();
  const f = ev.target;
  if (!f.date.value || !f.time.value) return showFormError($("#event-error"), "Indica el día y la hora.");
  if (!f.close_date.value || !f.close_time.value) return showFormError($("#event-error"), "Indica cuándo se cierra la votación.");
  const data = {
    title: f.title.value.trim(),
    starts_at: madridToIso(f.date.value, f.time.value),
    meeting_point: f.meeting_point.value.trim(),
    capacity: Number(f.capacity.value),
    max_km: Number(f.max_km.value),
    votes_close_at: madridToIso(f.close_date.value, f.close_time.value),
  };
  const btn = $("#event-save");
  btn.disabled = true;
  showFormError($("#event-error"), "");
  const isNew = !editing;
  try {
    const saved = isNew
      ? await api("/events", { method: "POST", body: JSON.stringify(data) })
      : await api(`/events/${encodeURIComponent(editing)}`, { method: "PATCH", body: JSON.stringify(data) });
    await reloadEvents();
    await selectEvent(saved.slug);
    toast(isNew ? "Evento creado" : "Evento guardado");
  } catch (e) {
    if (e.message !== "unauthorized") showFormError($("#event-error"), e.message);
  } finally {
    btn.disabled = false;
  }
}

async function deleteEvent() {
  const e = state.event;
  if (!e) return;
  const n = state.signups.length;
  const people = n === 1 ? "1 inscripción" : `${n} inscripciones`;
  if (!confirm(`¿Eliminar «${e.title}» (${fmtDate(e.starts_at, { day: "numeric", month: "long" })})?\n\nSe borrarán el evento, su ruta y ${people}. Los socios conservan su tarjeta y sus puntos.\n\nNo se puede deshacer.`)) return;
  const btn = $("#event-delete");
  btn.disabled = true;
  try {
    await api(`/events/${encodeURIComponent(e.slug)}`, { method: "DELETE" });
    state.event = null;
    toast(`Evento «${e.title}» eliminado`);
    await enterAdmin(); // vuelve a cargar y elige el próximo evento que quede
  } catch (err) {
    if (err.message !== "unauthorized") toast(err.message, "err");
  } finally {
    btn.disabled = false;
  }
}

// ---------- Utilidades ----------
export function showFormError(el, msg) {
  el.textContent = msg;
  el.hidden = !msg;
}

let toastTimer;
export function toast(msg, kind = "ok") {
  const el = $("#admin-toast");
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

function exportCsv() {
  const rows = filtered();
  const dist = distanceOptions(state.event.max_km);
  const head = ["Nombre", "Correo", "Teléfono", "Sexo", "Ritmo", "Intensidad", "Distancia", "Código", "Puntos", "Inscrito", "Fichado", "Último correo"];
  const data = rows.map((r) => [r.name, r.email, r.phone, GENDERS[r.gender] ?? "", PACES[r.pace]?.label ?? "", INTENSITIES[r.intensity]?.label ?? "",
    dist[r.distance]?.label ?? "", r.code, r.points, r.created_at, r.checked_in_at ?? "", r.last_emailed_at ?? ""]);
  // A leading = + - @ makes Excel and Sheets run the cell as a formula; the name comes from a public form.
  const cell = (v) => `"${String(v ?? "").replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
  const csv = [head, ...data].map((r) => r.map(cell).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  Object.assign(document.createElement("a"), { href: url, download: `${state.event.slug}-inscritos.csv` }).click();
  URL.revokeObjectURL(url);
}

// ---------- Contraseña de un socio ----------
async function resetMemberPassword(e) {
  e.preventDefault();
  const who = $("#reset-who").value.trim();
  const box = $("#reset-result");
  if (!who) return;
  if (!confirm(`¿Generar una contraseña nueva para «${who}»? La que tenga dejará de valer.`)) return;
  const btn = $("#reset-submit");
  btn.disabled = true;
  try {
    const r = await api("/members/password", { method: "POST", body: JSON.stringify({ who }) });
    box.className = "reset-result ok";
    box.innerHTML = `<span>${esc(r.name)} · ${esc(r.email)} · <code>${esc(r.code)}</code></span><b>${esc(r.password)}</b><small>Díctasela o enséñasela. No se vuelve a mostrar.</small>`;
    $("#reset-who").value = "";
  } catch (err) {
    if (err.message === "unauthorized") return;
    box.className = "reset-result err";
    box.textContent = err.message;
  } finally {
    box.hidden = false;
    btn.disabled = false;
  }
}

// ---------- Eventos del DOM ----------
function bind() {
  // El icono es la cuenta del socio; en tu móvil (con la sesión de admin y sin cuenta de socio) va directo al panel
  $("#account-btn").addEventListener("click", () => {
    if (state.token && !memberToken()) return enterAdmin();
    openAccount({ admin: Boolean(state.token), onAdmin: enterAdmin, onAdminLogin: () => openLogin() });
  });
  $("#reset-form").addEventListener("submit", resetMemberPassword);
  const markSigned = () => $("#account-btn").classList.toggle("signed", Boolean(memberToken()));
  document.addEventListener("nrc:session", markSigned);
  markSigned();
  $("#admin-public").addEventListener("click", leaveAdmin);
  $("#admin-logout").addEventListener("click", () => {
    saveToken(null);
    leaveAdmin();
    toast("Sesión cerrada");
  });
  $("#admin-event").addEventListener("change", (e) => selectEvent(e.target.value));
  $("#admin-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) showTab(b.dataset.tab);
  });

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#login-submit");
    btn.disabled = true;
    btn.textContent = "Entrando…";
    showFormError($("#login-error"), "");
    try {
      const { token } = await api("/login", { method: "POST", body: JSON.stringify({ password: $("#login-password").value }) });
      saveToken(token);
      $("#login-form").reset();
      closeModal($("#login-modal"));
      enterAdmin();
    } catch (err) {
      showFormError($("#login-error"), err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  });

  $("#admin-search").addEventListener("input", (e) => { state.query = e.target.value; renderList(); });
  $("#admin-filter").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-pace]");
    if (!b) return;
    state.pace = b.dataset.pace;
    $("#admin-filter").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderList();
  });
  $("#admin-csv").addEventListener("click", exportCsv);
  $("#admin-all").addEventListener("change", (e) => {
    filtered().forEach((s) => (e.target.checked ? state.selected.add(s.id) : state.selected.delete(s.id)));
    renderList();
  });
  $("#admin-list").addEventListener("click", (e) => {
    const row = e.target.closest(".person");
    if (!row) return;
    const id = Number(row.dataset.id);
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    row.classList.toggle("selected", state.selected.has(id));
    row.querySelector(".tick").checked = state.selected.has(id);
    renderSelection();
  });

  $("#admin-sel-clear").addEventListener("click", () => { state.selected.clear(); renderList(); });
  $("#admin-sel-mail").addEventListener("click", openMail);
  $("#admin-sel-delete").addEventListener("click", deleteSelected);
  $("#mail-templates").addEventListener("change", loadPreview);
  $("#mail-send").addEventListener("click", sendMail);
  $("#event-form").addEventListener("submit", saveEvent);
  $("#event-new").addEventListener("click", () => fillEventForm(null));
  $("#event-delete").addEventListener("click", deleteEvent);
  $("#ev-f-date").addEventListener("change", suggestClose);
  ["#ev-f-cdate", "#ev-f-ctime"].forEach((id) => $(id).addEventListener("input", () => { closeTouched = true; }));

  document.querySelectorAll("[data-close-login]").forEach((b) => b.addEventListener("click", () => closeModal($("#login-modal"))));
  document.querySelectorAll("[data-close-mail]").forEach((b) => b.addEventListener("click", () => closeModal($("#mail-modal"))));
  ["#login-modal", "#mail-modal"].forEach((id) => {
    $(id).addEventListener("click", (e) => { if (e.target.id === id.slice(1)) closeModal(e.target); });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") ["#login-modal", "#mail-modal"].forEach((id) => closeModal($(id)));
  });
  window.addEventListener("hashchange", () => {
    if (location.hash === "#admin") state.token ? enterAdmin() : openLogin();
  });
}

mount();
bind();
if (location.hash === "#admin") state.token ? enterAdmin() : openLogin();
