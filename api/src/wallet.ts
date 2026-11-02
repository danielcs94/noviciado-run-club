// Tarjeta de socio en Google Wallet (gratis). Hace falta una cuenta de emisor en
// https://pay.google.com/business/console y una cuenta de servicio de Google Cloud con
// la API de Google Wallet activada. Sin esas variables, la web solo ofrece la tarjeta web.
import { levelFor } from './club';

export interface WalletEnv {
  GW_ISSUER_ID?: string;
  GW_SA_EMAIL?: string;
  GW_SA_KEY?: string;
  SITE_URL: string;
}

export interface WalletMember {
  code: string;
  secret: string;
  name: string;
  points: number;
}

export const walletEnabled = (env: WalletEnv) => Boolean(env.GW_ISSUER_ID && env.GW_SA_EMAIL && env.GW_SA_KEY);

const CLASS_SUFFIX = 'noviciado_run_club';
const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function signJwt(env: WalletEnv, payload: Record<string, unknown>) {
  const pem = env.GW_SA_KEY!.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const body = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}

const text = (value: string) => ({ defaultValue: { language: 'es-ES', value } });

function passObject(env: WalletEnv, m: WalletMember) {
  const level = levelFor(m.points);
  const issuer = env.GW_ISSUER_ID!;
  return {
    id: `${issuer}.${m.code.replace(/[^\w.-]/g, '_')}`,
    classId: `${issuer}.${CLASS_SUFFIX}`,
    state: 'ACTIVE',
    cardTitle: text('Noviciado Run Club'),
    subheader: text('Socio'),
    header: text(m.name),
    hexBackgroundColor: '#0b0b0c',
    barcode: { type: 'QR_CODE', value: m.code, alternateText: m.code },
    textModulesData: [
      { id: 'nivel', header: 'Nivel', body: level.name },
      { id: 'puntos', header: 'Puntos', body: String(m.points) },
    ],
    linksModuleData: { uris: [{ uri: `${env.SITE_URL}tarjeta.html?c=${m.code}&k=${m.secret}`, description: 'Mi tarjeta en la web' }] },
  };
}

/** Enlace "Añadir a Google Wallet": crea la clase y la tarjeta la primera vez que se pulsa. */
export async function saveUrl(env: WalletEnv, m: WalletMember) {
  const jwt = await signJwt(env, {
    iss: env.GW_SA_EMAIL,
    aud: 'google',
    typ: 'savetowallet',
    origins: [new URL(env.SITE_URL).origin],
    payload: {
      genericClasses: [{ id: `${env.GW_ISSUER_ID}.${CLASS_SUFFIX}` }],
      genericObjects: [passObject(env, m)],
    },
  });
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

/** Actualiza puntos y nivel de una tarjeta ya guardada. Si aún no la ha guardado, no pasa nada. */
export async function updatePass(env: WalletEnv, m: WalletMember) {
  if (!walletEnabled(env)) return;
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(env, {
    iss: env.GW_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!tokenRes.ok) return;
  const { access_token } = await tokenRes.json<{ access_token: string }>();
  const obj = passObject(env, m);
  await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodeURIComponent(obj.id)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ header: obj.header, textModulesData: obj.textModulesData }),
  });
}
