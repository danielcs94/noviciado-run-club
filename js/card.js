// Tarjeta de socio en la web (tarjeta.html?c=NRC-XXXX&k=…): QR para fichar, puntos y nivel.
// Se recuerda en el móvil, así que desde la web del club se vuelve a ella con "Mi tarjeta".
/* global qrcode */
import { API, esc } from "./config.js";
import { CHECKIN_POINTS } from "./club.js";

const CARD_KEY = "nrc:card";
const root = document.querySelector("#card-root");
const params = new URLSearchParams(location.search);
let card = { code: params.get("c"), k: params.get("k") };

if (!card.code || !card.k) {
  try { card = JSON.parse(localStorage.getItem(CARD_KEY)) ?? card; } catch {}
}

async function load() {
  if (!card.code || !card.k) return fail("No encontramos tu tarjeta", "Abre el enlace que te dimos al apuntarte o el del correo del club.");
  let m;
  try {
    const res = await fetch(`${API}/card/${encodeURIComponent(card.code)}?k=${encodeURIComponent(card.k)}`);
    if (res.status === 404) return fail("Esta tarjeta no existe", "Revisa que el enlace esté completo.");
    if (!res.ok) throw new Error();
    m = await res.json();
  } catch {
    return fail("Sin conexión", "No hemos podido cargar tu tarjeta. Inténtalo de nuevo en un momento.");
  }
  try { localStorage.setItem(CARD_KEY, JSON.stringify(card)); } catch {}
  // La dirección siempre con el código, para que "Añadir a pantalla de inicio" guarde la tarjeta buena
  if (!params.get("c")) history.replaceState(null, "", `?c=${encodeURIComponent(card.code)}&k=${encodeURIComponent(card.k)}`);
  render(m);
}

function render(m) {
  const toNext = m.next ? m.next.from - m.points : 0;
  const pct = m.next ? Math.min(100, (m.points / m.next.from) * 100) : 100;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  root.innerHTML = `
    <div class="member-card" data-level="${esc(m.levelKey)}">
      <div class="top">
        <div><span class="eyebrow">Noviciado Run Club</span><h1 class="gold-text">${esc(m.name)}</h1></div>
        <span class="pass-level">${esc(m.level)}</span>
      </div>
      <div class="qr" id="qr" role="img" aria-label="Código QR de ${esc(m.code)}"></div>
      <code>${esc(m.code)}</code>
      <div class="progress">
        <header><span><b>${m.points}</b> puntos</span><span>${m.next ? `${toNext} para ${esc(m.next.name)} · ${Math.ceil(toNext / CHECKIN_POINTS)} carreras` : "Nivel máximo"}</span></header>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>
    </div>
    <div class="card-actions">
      ${m.wallet && !ios ? '<button class="btn-gold btn-block" type="button" id="wallet">Añadir a Google Wallet</button>' : ""}
    </div>
    ${standalone ? "" : `<p class="howto">${ios
      ? "<b>Guárdala en el iPhone:</b> pulsa Compartir en Safari y luego <b>Añadir a pantalla de inicio</b>. Se abrirá como una app y la tendrás a mano al llegar."
      : "<b>Enséñala al llegar</b> a cada quedada: escaneamos el código y sumas 10 puntos. Guarda esta página en favoritos o en la pantalla de inicio."}</p>`}`;
  const qr = qrcode(0, "M");
  qr.addData(m.code);
  qr.make();
  document.querySelector("#qr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
  document.querySelector("#wallet")?.addEventListener("click", addToWallet);
}

async function addToWallet(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/card/${encodeURIComponent(card.code)}/google?k=${encodeURIComponent(card.k)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.message);
    location.href = body.url;
  } catch (err) {
    btn.textContent = err.message || "No se pudo abrir Google Wallet";
    btn.disabled = false;
  }
}

function fail(title, text) {
  root.innerHTML = `<div class="card-error"><h1>${esc(title)}</h1><p>${esc(text)}</p><a class="btn-line" href="./">Ir a la web del club</a></div>`;
}

load();
