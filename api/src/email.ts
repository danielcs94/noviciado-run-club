// Plantillas de correo y envío con Brevo (plan gratuito: 300 correos al día).
// La plantilla definitiva está por hacer: de momento hay una provisional.

export interface MailContext {
  name: string;
  email: string;
  code: string;
  cardUrl: string;
  event: { title: string; starts_at: string; meeting_point: string };
}

export const TEMPLATES = [
  {
    key: 'general',
    name: 'Plantilla provisional',
    description: 'Recordatorio del evento con el enlace a la tarjeta de socio. La cambiaremos por la definitiva.',
    subject: ':event · Noviciado Run Club',
  },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function when(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}

export function renderEmail(key: string, c: MailContext): { subject: string; html: string } | null {
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) return null;
  const first = c.name.split(' ')[0];
  const subject = t.subject.replace(':event', c.event.title).replace(':name', first);
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#0b0b0c;font-family:Helvetica,Arial,sans-serif;color:#ece8e1">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0c;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141414;border:1px solid #2a2a2a;border-radius:24px;padding:36px 28px">
<tr><td style="font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#8d8a84">Noviciado · Run Club</td></tr>
<tr><td style="font-family:Georgia,serif;font-size:34px;color:#d9b56a;padding:14px 0 8px">Hola, ${esc(first)}</td></tr>
<tr><td style="font-size:15px;line-height:1.7;color:#bdb8b0;padding-bottom:22px">Este es un texto provisional: la plantilla definitiva está por llegar. Te esperamos en <b style="color:#ece8e1">${esc(c.event.title)}</b>.</td></tr>
<tr><td style="border-top:1px solid #2a2a2a;padding:18px 0;font-size:14px;line-height:1.8;color:#bdb8b0">
<b style="color:#ece8e1">Cuándo:</b> ${esc(when(c.event.starts_at))}<br>
<b style="color:#ece8e1">Dónde:</b> ${esc(c.event.meeting_point)}<br>
<b style="color:#ece8e1">Tu código:</b> <span style="font-family:Georgia,serif;color:#f3dca0;letter-spacing:2px">${esc(c.code)}</span></td></tr>
<tr><td align="center" style="padding-top:10px"><a href="${esc(c.cardUrl)}" style="display:inline-block;background:#d9b56a;color:#1b150b;text-decoration:none;font-size:12px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;padding:16px 26px;border-radius:999px">Ver mi tarjeta</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

export async function sendWithBrevo(
  apiKey: string, from: { email: string; name: string }, to: { email: string; name: string }, mail: { subject: string; html: string },
) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender: from, to: [to], subject: mail.subject, htmlContent: mail.html }),
  });
  if (!res.ok) throw new Error(`Brevo respondió ${res.status}`);
}
