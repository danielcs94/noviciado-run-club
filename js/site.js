// Web pública: próximo evento, ruta publicada y formulario de inscripción en dos pasos.
import { API, esc, fmtDate } from "./config.js";
import { GENDERS, INTENSITIES, LEVELS, PACES, distanceOptions, kmText } from "./club.js";
import { createRouteMap, downloadGpx, googleMapsUrl } from "./routemap.js";
import { currentAccount, forgetAccount, memberToken, saveSession, savedCard } from "./account.js";

const $ = (sel) => document.querySelector(sel);
let event = null;      // próximo evento (o null si no hay)
let routeMap = null;

// ---------- Evento ----------
async function loadEvent() {
  try {
    const res = await fetch(`${API}/events/next`);
    if (res.status === 404) return renderNoEvent();
    if (!res.ok) throw new Error(res.status);
    event = await res.json();
  } catch {
    $("#left").textContent = "No se pudo cargar el evento";
    return;
  }
  renderEvent();
  renderRoute();
  buildQuiz();
  renderVoting();
  startCountdown();
}

function renderNoEvent() {
  event = null;
  $("#status-pill").textContent = "Próximamente";
  $("#left").textContent = "Anunciaremos la próxima fecha muy pronto.";
  document.querySelectorAll("[data-open]").forEach((b) => (b.disabled = true));
}

function renderEvent() {
  const e = event;
  $("#ev-day").textContent = fmtDate(e.starts_at, { day: "2-digit" });
  $("#ev-month").textContent = fmtDate(e.starts_at, { month: "short" }).replace(".", "").toUpperCase();
  const weekday = fmtDate(e.starts_at, { weekday: "long" });
  $("#ev-when").textContent = `${weekday} · ${fmtDate(e.starts_at, { hour: "2-digit", minute: "2-digit" })}`;
  $("#ev-title").textContent = e.title;
  $("#ev-place").textContent = e.meeting_point;
  $("#sheet-title").textContent = e.title;
  $("#dock-title").textContent = e.title;
  $("#fact-km").textContent = kmText(e.max_km, e.max_km % 1 ? 1 : 0);
  renderCounter();
}

function renderCounter() {
  const e = event;
  $("#cap").textContent = e.capacity;
  $("#bar").style.width = Math.min(100, (e.booked / e.capacity) * 100) + "%";
  $("#left").textContent = e.left > 0 ? `Quedan ${e.left} plazas` : "Aforo completo";
  $("#status-pill").textContent = e.left > 0 ? "Plazas abiertas" : "Aforo completo";
  document.querySelectorAll("[data-open]").forEach((b) => (b.disabled = e.left <= 0));
  animateNumber($("#count"), e.booked);
}

function animateNumber(el, to) {
  const from = Number(el.textContent) || 0;
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / 900);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- Votación y cuenta atrás ----------
// De lunes a viernes se vota la ruta; después solo se inscribe (así da tiempo a publicarla).
const votingOpen = () => event?.voting_open && Date.now() < new Date(event.votes_close_at).getTime();

function renderVoting() {
  const open = votingOpen();
  $("#vote-fields").hidden = !open;
  const closed = $("#vote-closed");
  closed.hidden = open;
  closed.textContent = event.routes?.length
    ? "La ruta ya está publicada: la tienes en la ficha de la carrera. Solo dinos tu ritmo."
    : "La votación de la ruta ya está cerrada. Te apuntas igual y publicamos el recorrido antes de la salida.";
  if (!event.routes?.length) {
    $("#route-empty-text").innerHTML = open
      ? `<b style="color:var(--text);font-weight:500">La ruta la decidimos entre todos.</b> Cuando te apuntas, votas cuánto quieres correr y cómo de dura la quieres. Se puede votar hasta el ${esc(closeText())}; después publicamos aquí el recorrido, con el mapa, el desnivel y el enlace para llevarlo en el móvil.`
      : `<b style="color:var(--text);font-weight:500">Votación cerrada.</b> Estamos trazando la ruta con lo que habéis votado y la publicaremos aquí antes de la salida. Aún puedes apuntarte.`;
    $("#route-empty-btn").textContent = open ? "Apúntate y vota" : "Apúntate";
  }
}

const closeText = () => `${fmtDate(event.votes_close_at, { weekday: "long", day: "numeric" })} a las ${fmtDate(event.votes_close_at, { hour: "2-digit", minute: "2-digit" })}`;

let countdownTimer = null;
function startCountdown() {
  clearInterval(countdownTimer);
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function tick() {
  const box = $("#countdown");
  const now = Date.now();
  const start = new Date(event.starts_at).getTime();
  if (now >= start) { box.hidden = true; clearInterval(countdownTimer); return; }
  const open = votingOpen();
  // Si la votación se cierra con la página abierta, el formulario pasa a "solo inscribirse"
  if (event.voting_open && !open) { event.voting_open = false; renderVoting(); validateStep2(); }
  const target = open ? new Date(event.votes_close_at).getTime() : start;
  box.hidden = false;
  box.classList.toggle("closed", !open && !event.routes?.length);
  $("#countdown-label").textContent = open ? "Votación de la ruta · cierra en" : "Salida en";
  $("#countdown-value").innerHTML = span(target - now);
  $("#countdown-note").textContent = open
    ? `Hasta el ${closeText()}. Después solo inscripción.`
    : event.routes?.length ? "La ruta ya está publicada: mírala más abajo" : "Votación cerrada · publicamos la ruta antes de la salida";
}

// 2 d 14 h 05 min; el último día, con segundos
function span(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const part = (n, u) => `${n}<span>${u}</span>`;
  const pad = (n) => String(n).padStart(2, "0");
  return d ? `${part(d, "d")}${part(h, "h")}${part(pad(m), "min")}` : `${part(h, "h")}${part(pad(m), "min")}${part(pad(sec), "s")}`;
}

// ---------- Ruta publicada ----------
function renderRoute() {
  const routes = event.routes;
  if (!routes?.length) return; // se queda el texto de "la decidimos entre todos"
  $("#route-title").textContent = routes.length > 1 ? "Dos recorridos" : routes[0].name;

  const tabs = $("#route-tabs");
  tabs.hidden = routes.length < 2;
  tabs.innerHTML = routes.map((r, i) =>
    `<button type="button" role="tab" aria-selected="${i === 0}" data-i="${i}">${esc(r.label)} · ${kmText(r.km)} km</button>`).join("");

  $("#route-body").innerHTML = `
    <div class="route-map" id="route-map"></div>
    <div class="route-stats" id="route-stats"></div>
    <div class="route-foot">
      <p id="route-desc"></p>
      <div class="actions">
        <a class="btn-gold" id="route-gmaps" target="_blank" rel="noopener">Abrir en Google Maps</a>
        <button class="btn-line" type="button" id="route-gpx">Descargar GPX</button>
      </div>
    </div>`;

  try {
    routeMap = createRouteMap($("#route-map"));
    routeMap.show(routes, 0);
  } catch {
    $("#route-map").innerHTML = '<p class="note" style="padding:40px 20px">No se pudo cargar el mapa.</p>';
  }
  showRouteInfo(0);

  tabs.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const i = Number(b.dataset.i);
    tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    routeMap?.select(i);
    showRouteInfo(i);
  });
}

function showRouteInfo(i) {
  const r = event.routes[i];
  const park = r.surface ? Math.round((r.surface.parque ?? 0) + (r.surface.tierra ?? 0)) : null;
  const time = r.minutes ? `${Math.round(r.minutes[0])}–${Math.round(r.minutes[1])}′` : "—";
  $("#route-stats").innerHTML = `
    <div><b>${kmText(r.km, 2)}</b><span>km</span></div>
    <div><b>${r.gain != null ? `+${Math.round(r.gain)}` : "—"}</b><span>m desnivel</span></div>
    <div><b>${park != null ? `${park}%` : "—"}</b><span>parque o tierra</span></div>
    <div><b>${time}</b><span>${r.pace ? `ritmo ${esc(PACES[r.pace]?.label.toLowerCase() ?? "")}` : "minutos"}</span></div>`;
  const by = r.landmarks?.length ? `Pasa por ${r.landmarks.slice(0, 5).join(", ")}.` : "";
  const intensity = INTENSITIES[r.intensity] ? `Intensidad ${INTENSITIES[r.intensity].label.toLowerCase()}.` : "";
  const two = event.routes.length > 1 ? (i === 0 ? " Para los grupos tranquilo y medio." : " Para el grupo rápido: así llegamos todos a la vez.") : "";
  $("#route-desc").textContent = `${by || `${r.name}.`} ${intensity}${two}`.replace(/\s+/g, " ").trim();
  $("#route-gmaps").href = googleMapsUrl(r);
  $("#route-gpx").onclick = () => downloadGpx(r, `${event.title} · ${r.label}`);
}

// ---------- Tarjeta de socio (sección informativa) ----------
// Al pulsar un nivel, la tarjeta de ejemplo cambia a su color
$("#levels").innerHTML = LEVELS.map((l, i) =>
  `<li><button type="button" data-level="${l.key}" aria-pressed="${i === 0}"><b>${l.name}</b><span>${l.from ? `desde ${l.from} puntos · ${l.from / 10} carreras` : "al apuntarte"}</span></button></li>`).join("");
$("#levels").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-level]");
  if (!b) return;
  const level = LEVELS.find((l) => l.key === b.dataset.level);
  const pass = $("#preview-pass");
  if (pass.dataset.level === level.key) return;
  $("#levels").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  pass.dataset.level = level.key;
  $("#preview-level").textContent = `${level.name} · ${level.from} puntos`;
  pass.classList.remove("flip");
  void pass.offsetWidth; // reinicia la animación
  pass.classList.add("flip");
});

// ---------- Formulario ----------
const modal = $("#modal");
const sheet = modal.querySelector(".sheet");
const form = $("#form");
const fields = { name: $("#name"), email: $("#email"), email2: $("#email2"), phone: $("#phone"), password: $("#password") };
let me = null; // la cuenta con la sesión abierta: se apunta con ella, sin repetir sus datos

const chip = (name, value, label, hint, checked = false) =>
  `<label class="chip"><input type="radio" name="${name}" value="${value}" ${checked ? "checked" : ""}><span${hint ? "" : ' class="flat"'}><b>${label}</b>${hint ? `<small>${hint}</small>` : ""}</span></label>`;

function buildQuiz() {
  $("#gender-chips").innerHTML = Object.entries(GENDERS).map(([k, v]) => chip("gender", k, v)).join("") + chip("gender", "", "Prefiero no decirlo");
  $("#pace-chips").innerHTML = Object.entries(PACES).map(([k, p]) => chip("pace", k, p.label, p.hint)).join("");
  $("#intensity-chips").innerHTML = Object.entries(INTENSITIES).map(([k, p]) => chip("intensity", k, p.label, p.hint)).join("");
  $("#distance-chips").innerHTML = Object.entries(distanceOptions(event.max_km)).map(([k, d]) => chip("distance", k, d.label, d.hint)).join("");
}

function setStep(n) {
  $("#step-1").hidden = n !== 1;
  $("#step-2").hidden = n !== 2;
  $("#stepper-2").classList.toggle("on", n === 2);
  $("#sheet-step").textContent = n === 1 ? "Paso 1 de 2 · Tus datos" : votingOpen() ? "Paso 2 de 2 · Tu ruta" : "Paso 2 de 2 · Tu ritmo";
  sheet.scrollTop = 0;
  if (n === 2) validateStep2();
}

async function openModal() {
  if (!event) return;
  sheet.classList.remove("success");
  me = await currentAccount();
  showIdentity();
  setStep(1);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  if (!me) setTimeout(() => fields.name.focus(), 250);
}

function showIdentity() {
  $("#identity-fields").hidden = Boolean(me);
  $("#as-member").hidden = !me;
  if (me) {
    $("#as-member").innerHTML = `<span class="eyebrow">Te apuntas como</span><b>${esc(me.name)}</b><small>${esc(me.email)} · <code>${esc(me.code)}</code></small><button class="link-back" type="button" id="not-me">¿No eres tú? Cerrar sesión</button>`;
    $("#not-me").addEventListener("click", () => { saveSession(null); forgetAccount(); me = null; showIdentity(); validateStep1(); });
  }
  validateStep1();
}
function closeModal() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}
document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", openModal));
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const phoneOk = (v) => /^\+?\d{9,15}$/.test(v.replace(/[\s\-().]/g, ""));

function checkField(input, ok) {
  const field = input.closest(".field");
  field.classList.toggle("valid", ok);
  field.classList.toggle("invalid", input.dataset.touched === "1" && !ok && input.value !== "");
  return ok;
}

function validateStep1() {
  if (me) { $("#next").disabled = false; return true; }
  const f = fields;
  const okName = checkField(f.name, f.name.value.trim().length >= 3);
  const okEmail = checkField(f.email, emailOk(f.email.value.trim()));
  const same = f.email2.value.trim().toLowerCase() === f.email.value.trim().toLowerCase();
  const okEmail2 = checkField(f.email2, okEmail && same);
  const okPhone = checkField(f.phone, phoneOk(f.phone.value));
  const okPassword = checkField(f.password, f.password.value.length >= 8 && f.password.value.length <= 128);
  $("#email-hint").textContent = f.email2.dataset.touched === "1" && f.email2.value && !same
    ? "Los correos no coinciden."
    : "Con tu correo te reconocemos como socio, asegúrate de que está bien.";
  const ok = okName && okEmail && okEmail2 && okPhone && okPassword;
  $("#next").disabled = !ok;
  return ok;
}

function validateStep2() {
  const needed = votingOpen() ? ["pace", "intensity", "distance"] : ["pace"];
  const ok = needed.every((n) => form.querySelector(`input[name="${n}"]:checked`))
    && form.terms.checked && event?.left > 0;
  $("#submit").disabled = !ok;
  return ok;
}

Object.values(fields).forEach((input) => {
  input.addEventListener("input", validateStep1);
  input.addEventListener("blur", () => { input.dataset.touched = "1"; validateStep1(); });
});
$("#step-1").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); $("#next").click(); }
});
$("#next").addEventListener("click", () => { if (validateStep1()) setStep(2); });
$("#back").addEventListener("click", () => setStep(1));
$("#step-2").addEventListener("change", validateStep2);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validateStep1()) return setStep(1);
  if (!validateStep2()) return;

  const fd = new FormData(form);
  // Socio de antes de las cuentas con su tarjeta en este móvil: al apuntarse se le activa la cuenta
  const card = savedCard();
  const data = {
    ...(me ? {} : {
      name: fd.get("name"), email: fd.get("email"), phone: fd.get("phone"),
      gender: fd.get("gender") || null, password: fd.get("password"),
      ...(card?.k ? { card_k: card.k } : {}),
    }),
    pace: fd.get("pace"),
    ...(votingOpen() ? { intensity: fd.get("intensity"), distance: fd.get("distance") } : {}),
    terms: true,
  };
  const submit = $("#submit");
  submit.disabled = true;
  submit.textContent = "Reservando…";
  showError("");

  let res, body;
  try {
    res = await fetch(`${API}/events/${encodeURIComponent(event.slug)}/signups`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(me && memberToken() ? { Authorization: `Bearer ${memberToken()}` } : {}) },
      body: JSON.stringify(data),
    });
    body = await res.json();
  } catch {
    return failSubmit("No hemos podido conectar. Inténtalo de nuevo en un momento.");
  }

  if (res.status === 401) {
    // La sesión caducó: que rellene sus datos (o entre otra vez)
    saveSession(null);
    forgetAccount();
    me = null;
    showIdentity();
    setStep(1);
    return failSubmit(body.message);
  }
  if (res.status === 422) {
    // Los errores de tus datos se arreglan en el paso 1
    if (body.errors && ["name", "email", "phone", "gender", "password"].some((k) => body.errors[k])) {
      setStep(1);
      if (body.errors.email) {
        fields.email.dataset.touched = "1";
        fields.email.closest(".field").classList.replace("valid", "invalid");
        $("#email-hint").textContent = body.errors.email;
      }
      if (body.errors.password) {
        fields.password.dataset.touched = "1";
        fields.password.closest(".field").classList.replace("valid", "invalid");
        $("#password-hint").textContent = `${body.errors.password} Si la has olvidado, pídenos una nueva en el club.`;
      }
    }
    return failSubmit(body.message);
  }
  if (res.status === 409) {
    event.left = 0;
    renderCounter();
    return failSubmit(body.message === "Aforo completo." ? "Lo sentimos, el aforo se acaba de completar." : body.message);
  }
  if (!res.ok) return failSubmit(body.message ?? "Algo ha fallado. Inténtalo de nuevo.");

  event.booked = body.booked;
  event.left = Math.max(0, body.capacity - body.booked);
  renderCounter();
  showSuccess(body);

  form.reset();
  Object.values(fields).forEach((i) => { delete i.dataset.touched; i.closest(".field").className = "field"; });
  $("#password-hint").textContent = "Mínimo 8 caracteres. Con tu correo y esta contraseña entras en tu cuenta, en el icono de arriba a la derecha. Si ya tienes cuenta, pon tu contraseña.";
  submit.textContent = "Reservar mi plaza";
});

function showError(msg) {
  const el = $("#form-error");
  el.textContent = msg;
  el.hidden = !msg;
}
function failSubmit(msg) {
  showError(msg);
  $("#submit").textContent = "Reservar mi plaza";
  validateStep2();
}

function showSuccess(b) {
  $("#pass-name").textContent = b.name;
  $("#pass-code").textContent = b.code;
  $("#pass-event").textContent = event.title;
  $("#pass-level").textContent = `${b.level} · ${b.points} puntos`;
  const when = `${fmtDate(event.starts_at, { weekday: "long", day: "numeric" })}, ${fmtDate(event.starts_at, { hour: "2-digit", minute: "2-digit" })}`;
  // Mientras no haya correo (falta el dominio), todo lo que necesita lo ve aquí
  const intro = `Te esperamos en el club el ${when}. Al llegar, di tu nombre y listo.`;

  const accountBtn = $("#done-account");
  const wallet = $("#done-wallet");
  if (b.token) {
    saveSession(b.token, b.card);
    forgetAccount();
    showMyCardLink();
    accountBtn.hidden = false;
    $("#done-text").textContent = b.newMember
      ? `${intro} Ya tienes tu cuenta de socio: en el icono de arriba a la derecha ves tu tarjeta con el QR y tus puntos. Enséñala al llegar para sumar puntos.`
      : `${intro} Tu tarjeta con el QR y tus puntos están en tu cuenta, en el icono de arriba a la derecha. Enséñala al llegar para sumar puntos.`;
    wallet.hidden = !b.wallet;
    wallet.onclick = () => addToGoogleWallet(b.card, wallet);
  } else {
    accountBtn.hidden = true;
    wallet.hidden = true;
    $("#done-text").textContent = `${intro} Tu correo ya era socio de antes de que hubiera cuentas: pídenos en el club que te la activemos y te damos tu contraseña.`;
  }
  sheet.classList.add("success");
  sheet.scrollTop = 0;
}

export async function addToGoogleWallet(card, button) {
  button.disabled = true;
  try {
    const res = await fetch(`${API}/card/${encodeURIComponent(card.code)}/google?k=${encodeURIComponent(card.k)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.message);
    location.href = body.url;
  } catch (e) {
    button.textContent = e.message || "No se pudo abrir Google Wallet";
  } finally {
    button.disabled = false;
  }
}

$("#done-account").addEventListener("click", () => {
  closeModal();
  document.querySelector("#account-btn")?.click();
});
document.addEventListener("nrc:session", showMyCardLink);

// "Mi tarjeta" en la cabecera si este móvil ya tiene una guardada
function showMyCardLink() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("nrc:card")); } catch {}
  const link = $("#my-card");
  link.hidden = !saved?.code;
  if (saved?.code) link.href = `tarjeta.html?c=${encodeURIComponent(saved.code)}&k=${encodeURIComponent(saved.k)}`;
}

showMyCardLink();
loadEvent();
