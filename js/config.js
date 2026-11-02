// Dirección de la API: en local (o desde el móvil por la wifi) el Worker de `npm run dev`;
// publicada, el de Cloudflare.
const LOCAL = /^(localhost|127\.0\.0\.1|.*\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

export const API = LOCAL.test(location.hostname)
  ? `${location.protocol}//${location.hostname}:8787`
  : "https://noviciado-run-club.danielcs94.workers.dev";

// Escapa texto que viene de fuera (nombres de un formulario público) antes de meterlo en HTML
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const fmtDate = (iso, opts) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", ...opts });
