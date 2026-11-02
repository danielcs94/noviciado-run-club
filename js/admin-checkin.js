// Pestaña "Fichar": escanea el QR de la tarjeta de socio con la cámara (o escribe el código)
// y suma los puntos de la quedada. Si la persona no se había apuntado, se le ficha igual.
import { esc, fmtDate } from "./config.js";
import { CHECKIN_POINTS } from "./club.js";
import { $, api, reloadSignups, state } from "./admin.js";

const JSQR_URL = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
let root = null;
let stream = null;
let raf = 0;
let lastCode = "";
let lastAt = 0;
let busy = false;

export function mountCheckinTab(container) {
  root = container;
  root.innerHTML = `
    <div class="checkin">
      <section class="card chart-card scan-card">
        <span class="eyebrow">Tarjeta de socio</span>
        <h2>Fichar a la llegada</h2>
        <div class="scanner" id="scanner">
          <video id="scan-video" playsinline muted></video>
          <div class="scan-frame" aria-hidden="true"></div>
          <p class="scan-idle" id="scan-idle">Pulsa el botón y apunta al código QR de la tarjeta.</p>
        </div>
        <button class="btn-gold btn-block" type="button" id="scan-toggle">Abrir la cámara</button>
        <form class="manual" id="manual-form" novalidate>
          <div class="field"><input id="manual-code" name="code" placeholder=" " autocomplete="off" autocapitalize="characters" maxlength="12"><label for="manual-code">O escribe el código (NRC-XXXX)</label></div>
          <button class="btn-line" type="submit">Fichar</button>
        </form>
        <div class="checkin-result" id="checkin-result" aria-live="polite" hidden></div>
      </section>
      <section class="card chart-card">
        <span class="eyebrow">Hoy</span>
        <h2 id="checked-title">Fichados</h2>
        <div id="checked-list"></div>
      </section>
    </div>`;
  $("#scan-toggle", root).addEventListener("click", () => (stream ? stopScanner() : startScanner()));
  $("#manual-form", root).addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("#manual-code", root).value.trim();
    if (code) checkin(code).then((ok) => { if (ok) $("#manual-code", root).value = ""; });
  });
}

export function renderCheckinTab() {
  if (!root || !state.event) return;
  const list = state.signups.filter((s) => s.checked_in_at).sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at));
  const expected = state.signups.filter((s) => !s.walk_in).length;
  $("#checked-title", root).textContent = `Fichados · ${list.length}${expected ? ` de ${expected} apuntados` : ""}`;
  $("#checked-list", root).innerHTML = list.length
    ? list.map((s) => `<div class="checked-row"><b>${esc(s.name)}</b><span>${s.walk_in ? "sin inscripción · " : ""}${esc(fmtDate(s.checked_in_at, { hour: "2-digit", minute: "2-digit" }))} · ${s.points} pts</span></div>`).join("")
    : '<p class="note" style="text-align:left">Todavía no ha fichado nadie en este evento.</p>';
}

async function startScanner() {
  const idle = $("#scan-idle", root);
  if (!navigator.mediaDevices?.getUserMedia) {
    idle.textContent = "Este navegador no deja usar la cámara (hace falta https). Escribe el código a mano.";
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    idle.textContent = "No hay permiso para usar la cámara. Actívalo en el navegador o escribe el código.";
    stream = null;
    return;
  }
  const video = $("#scan-video", root);
  video.srcObject = stream;
  await video.play();
  $("#scanner", root).classList.add("live");
  $("#scan-toggle", root).textContent = "Cerrar la cámara";
  const detect = await makeDetector();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const tick = async () => {
    if (!stream) return;
    if (video.readyState >= 2 && !busy) {
      const code = await detect(video, canvas, ctx);
      // El mismo código seguido no se ficha dos veces en 4 s (la cámara lo ve muchas veces por segundo)
      if (code && (code !== lastCode || Date.now() - lastAt > 4000)) {
        lastCode = code;
        lastAt = Date.now();
        navigator.vibrate?.(60);
        await checkin(code);
      }
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
}

// BarcodeDetector donde exista (Chrome en Android); si no, jsQR (iPhone)
async function makeDetector() {
  if ("BarcodeDetector" in window) {
    try {
      const bd = new window.BarcodeDetector({ formats: ["qr_code"] });
      return async (video) => (await bd.detect(video).catch(() => []))[0]?.rawValue ?? null;
    } catch {}
  }
  if (!window.jsQR) {
    await new Promise((ok, fail) => {
      const s = Object.assign(document.createElement("script"), { src: JSQR_URL, onload: ok, onerror: fail });
      document.head.append(s);
    });
  }
  return async (video, canvas, ctx) => {
    const w = 480, h = Math.round((video.videoHeight / video.videoWidth) * 480) || 360;
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    return window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

export function stopScanner() {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (!root) return;
  $("#scanner", root).classList.remove("live");
  $("#scan-toggle", root).textContent = "Abrir la cámara";
}

async function checkin(raw) {
  // El QR lleva solo el código; si alguien escanea el enlace de la web, también vale
  const code = (raw.match(/NRC-?[A-Z0-9]{4}/i)?.[0] ?? raw).toUpperCase();
  const box = $("#checkin-result", root);
  busy = true;
  try {
    const r = await api(`/events/${encodeURIComponent(state.event.slug)}/checkin`, { method: "POST", body: JSON.stringify({ code }) });
    box.className = `checkin-result ${r.already ? "warn" : "ok"}`;
    box.innerHTML = r.already
      ? `<b>${esc(r.name)}</b> ya había fichado hoy.<small>${r.points} puntos · ${esc(r.level)}</small>`
      : `<b>${esc(r.name)}</b> +${CHECKIN_POINTS} puntos${r.levelUp ? ` · ¡sube a ${esc(r.level)}!` : ""}<small>${r.points} puntos · ${esc(r.level)}${r.walkIn ? " · no se había apuntado" : ""}</small>`;
    box.hidden = false;
    await reloadSignups();
    return true;
  } catch (e) {
    if (e.message === "unauthorized") return false;
    box.className = "checkin-result err";
    box.innerHTML = `<b>${esc(e.message)}</b>`;
    box.hidden = false;
    return false;
  } finally {
    busy = false;
  }
}
