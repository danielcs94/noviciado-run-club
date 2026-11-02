// Web pública: próximo evento, ruta publicada y formulario de inscripción en dos pasos.
import { API, esc, fmtDate } from "./config.js";
import { GENDERS, INTENSITIES, LEVELS, PACES, distanceOptions, kmText } from "./club.js";
import { createRouteMap, downloadGpx, googleMapsUrl } from "./routemap.js";

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
const fields = { name: $("#name"), email: $("#email"), email2: $("#email2"), phone: $("#phone") };

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
  $("#sheet-step").textContent = n === 1 ? "Paso 1 de 2 · Tus datos" : "Paso 2 de 2 · Tu ruta";
  sheet.scrollTop = 0;
  if (n === 2) validateStep2();
}

function openModal() {
  if (!event) return;
  sheet.classList.remove("success");
  setStep(1);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => fields.name.focus(), 250);
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
  const f = fields;
  const okName = checkField(f.name, f.name.value.trim().length >= 3);
  const okEmail = checkField(f.email, emailOk(f.email.value.trim()));
  const same = f.email2.value.trim().toLowerCase() === f.email.value.trim().toLowerCase();
  const okEmail2 = checkField(f.email2, okEmail && same);
  const okPhone = checkField(f.phone, phoneOk(f.phone.value));
  $("#email-hint").textContent = f.email2.dataset.touched === "1" && f.email2.value && !same
    ? "Los correos no coinciden."
    : "Aquí te mandamos la invitación, asegúrate de que está bien.";
  const ok = okName && okEmail && okEmail2 && okPhone;
  $("#next").disabled = !ok;
  return ok;
}

function validateStep2() {
  const ok = ["pace", "intensity", "distance"].every((n) => form.querySelector(`input[name="${n}"]:checked`))
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
  const data = {
    name: fd.get("name"), email: fd.get("email"), phone: fd.get("phone"),
    gender: fd.get("gender") || null,
    pace: fd.get("pace"), intensity: fd.get("intensity"), distance: fd.get("distance"),
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    body = await res.json();
  } catch {
    return failSubmit("No hemos podido conectar. Inténtalo de nuevo en un momento.");
  }

  if (res.status === 422) {
    // Los errores de tus datos se arreglan en el paso 1
    if (body.errors && ["name", "email", "phone", "gender"].some((k) => body.errors[k])) {
      setStep(1);
      if (body.errors.email) {
        fields.email.dataset.touched = "1";
        fields.email.closest(".field").classList.replace("valid", "invalid");
        $("#email-hint").textContent = body.errors.email;
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
  const intro = `Te hemos guardado la plaza con ${b.email}. Te esperamos el ${when} en la puerta del café.`;

  const cardLink = $("#done-card");
  const wallet = $("#done-wallet");
  if (b.card) {
    try { localStorage.setItem("nrc:card", JSON.stringify(b.card)); } catch {}
    showMyCardLink();
    cardLink.href = `tarjeta.html?c=${encodeURIComponent(b.card.code)}&k=${encodeURIComponent(b.card.k)}`;
    cardLink.hidden = false;
    $("#done-text").textContent = `${intro} Esta es tu tarjeta de socio: guárdala y enséñala al llegar para sumar puntos.`;
    wallet.hidden = !b.wallet;
    wallet.onclick = () => addToGoogleWallet(b.card, wallet);
  } else {
    cardLink.hidden = true;
    wallet.hidden = true;
    $("#done-text").textContent = `${intro} Ya eras socio: enseña tu tarjeta de siempre al llegar y sumarás los puntos.`;
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
