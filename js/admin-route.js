// Pestaña "Ruta" del panel: resumen de lo que ha votado la gente, una propuesta automática,
// el generador de Rutas Noviciado (en el navegador) y el botón para publicar en la web.
import { esc, fmtDate } from "./config.js";
import { INTENSITIES, MIN_KM, PACES, distanceOptions, kmText } from "./club.js";
import { groupWeight, plan, PREFERENCES } from "./rutas/planner.js";
import { createRouteMap } from "./routemap.js";
import { $, api, reloadEvents, state, toast } from "./admin.js";

const ui = {
  two: false,             // ¿dos recorridos?
  slot: 0,                // ruta que se está editando (0 = única o corta, 1 = larga)
  slots: [newSlot(), newSlot()],
  candidates: [],
  preview: null,          // índice del candidato que se ve en el mapa
  busy: false,
  eventSlug: null,
};
let routeMap = null;
let root = null;

function newSlot() {
  return { km: 7, intensity: "medio", prefer: "parques", people: null, chosen: null }; // people null = los apuntados
}

export function mountRouteTab(container) {
  root = container;
  root.innerHTML = `
    <div class="route-admin">
      <section class="card chart-card votes-card">
        <span class="eyebrow">Lo que pide la gente</span>
        <h2>Votos</h2>
        <div id="votes"></div>
        <div class="proposal" id="proposal"></div>
      </section>

      <section class="card chart-card gen-card">
        <div class="section-head">
          <div>
            <span class="eyebrow">Generador</span>
            <h2>Trazar la ruta</h2>
          </div>
          <label class="switch"><input type="checkbox" id="gen-two"><span>Dos recorridos</span></label>
        </div>
        <div class="tabs" id="gen-slots" role="tablist" hidden>
          <button type="button" data-slot="0" aria-selected="true">Corta</button>
          <button type="button" data-slot="1" aria-selected="false">Larga</button>
        </div>
        <div class="gen-controls">
          <label class="gen-km">
            <span class="eyebrow">Distancia</span>
            <b id="gen-km-label">7 km</b>
            <input type="range" id="gen-km" min="${MIN_KM}" max="10" step="0.5" value="7">
          </label>
          <div>
            <span class="eyebrow">Intensidad</span>
            <div class="seg" id="gen-intensity">${Object.entries(INTENSITIES).map(([k, v]) => `<button type="button" data-v="${k}">${v.label}</button>`).join("")}</div>
          </div>
          <div>
            <span class="eyebrow">Por dónde</span>
            <div class="seg" id="gen-prefer">${Object.entries(PREFERENCES).map(([k, v]) => `<button type="button" data-v="${k}" title="${esc(v.hint)}">${v.label}</button>`).join("")}</div>
          </div>
        </div>
        <div class="gen-people">
          <div class="field"><input id="gen-people" type="number" min="1" max="500" inputmode="numeric" placeholder=" "><label for="gen-people">Personas</label></div>
          <p class="hint" id="gen-people-hint"></p>
        </div>
        <button class="btn-gold btn-block" type="button" id="gen-run">Generar rutas</button>
        <p class="gen-progress" id="gen-progress" hidden></p>
        <div class="gen-body">
          <div class="gen-map" id="gen-map"></div>
          <div class="candidates" id="candidates"><p class="note">Genera para ver cuatro bucles distintos que salen y vuelven a Noviciado.</p></div>
        </div>
      </section>

      <section class="card publish-card" id="publish"></section>
    </div>`;

  $("#gen-two", root).addEventListener("change", (e) => {
    ui.two = e.target.checked;
    ui.slot = 0;
    syncControls();
    renderPublish();
  });
  $("#gen-slots", root).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-slot]");
    if (!b) return;
    ui.slot = Number(b.dataset.slot);
    ui.candidates = [];
    ui.preview = null;
    syncControls();
    renderCandidates();
    showOnMap();
  });
  $("#gen-km", root).addEventListener("input", (e) => {
    slot().km = Number(e.target.value);
    $("#gen-km-label", root).textContent = `${kmText(slot().km, slot().km % 1 ? 1 : 0)} km`;
  });
  for (const id of ["gen-intensity", "gen-prefer"]) {
    $(`#${id}`, root).addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      slot()[id === "gen-intensity" ? "intensity" : "prefer"] = b.dataset.v;
      syncControls();
    });
  }
  $("#gen-people", root).addEventListener("input", (e) => {
    const n = Math.round(Number(e.target.value));
    slot().people = n > 0 ? Math.min(500, n) : null;
    peopleHint();
  });
  $("#gen-run", root).addEventListener("click", generate);
  $("#candidates", root).addEventListener("click", (e) => {
    const card = e.target.closest("[data-c]");
    if (!card) return;
    const i = Number(card.dataset.c);
    if (e.target.closest("[data-choose]")) {
      slot().chosen = ui.candidates[i];
      renderPublish();
      toast(`${ui.two ? (ui.slot ? "Ruta larga" : "Ruta corta") : "Ruta"} elegida: ${kmText(ui.candidates[i].km, 2)} km`);
    }
    ui.preview = i;
    renderCandidates();
    showOnMap();
  });
  $("#proposal", root).addEventListener("click", (e) => { if (e.target.closest("#use-proposal")) applyProposal(); });
  root.addEventListener("click", (e) => {
    if (e.target.closest("#publish-btn")) publish();
    if (e.target.closest("#unpublish-btn")) unpublish();
  });
}

const slot = () => ui.slots[ui.slot];
const maxKm = () => state.event?.max_km ?? 10;

// Cuántos van a correr esta ruta: los apuntados; con dos recorridos, la corta es para los
// ritmos tranquilo y medio y la larga para el rápido.
function autoPeople(i = ui.slot) {
  const booked = state.signups.filter((s) => !s.walk_in);
  if (!ui.two) return booked.length;
  const fast = booked.filter((s) => s.pace === "rapido").length;
  return i === 1 ? fast : booked.length - fast;
}
const people = () => slot().people ?? autoPeople();

function peopleHint() {
  const n = people();
  const g = groupWeight(n);
  $("#gen-people-hint", root).textContent = (slot().people == null ? `Los apuntados${ui.two ? (ui.slot ? " a ritmo rápido" : " a ritmo tranquilo y medio") : ""}. Cámbialo si esperas más gente. ` : "")
    + (g === 0 ? "Grupo pequeño: cualquier calle vale."
      : g < 1.5 ? "Grupo mediano: evita calles estrechas, avenidas con tráfico y cruces cuando puede."
      : "Grupo grande: busca paseos amplios y parques, y huye de calles estrechas, avenidas y cruces.");
}

export function renderRouteTab() {
  if (!root || !state.event) return;
  // Al cambiar de evento se empieza de cero, con la propuesta de sus votos
  if (ui.eventSlug !== state.event.slug) {
    ui.eventSlug = state.event.slug;
    ui.slots = [newSlot(), newSlot()];
    ui.candidates = [];
    ui.preview = null;
    applyProposal(false);
  }
  renderVotes();
  syncControls();
  renderCandidates();
  renderPublish();
  if (!routeMap) {
    try { routeMap = createRouteMap($("#gen-map", root)); } catch { $("#gen-map", root).innerHTML = '<p class="note">No se pudo cargar el mapa.</p>'; }
  }
  setTimeout(() => { routeMap?.map.resize(); showOnMap(); }, 50);
}

// ---------- Votos y propuesta ----------
const voters = () => state.signups.filter((s) => !s.walk_in && s.distance);

function bars(title, options, key) {
  const list = voters();
  const total = list.length || 1;
  return `<div class="vote-group"><span class="eyebrow">${title}</span>${Object.entries(options).map(([k, o]) => {
    const n = list.filter((s) => s[key] === k).length;
    const pct = Math.round((n / total) * 100);
    return `<div class="pace-row"><header><b>${esc(o.label)}</b><span>${n} · ${list.length ? pct : 0}%</span></header>
      <div class="pace-track"><i style="width:${list.length ? pct : 0}%; background:var(--gold)"></i></div></div>`;
  }).join("")}</div>`;
}

function renderVotes() {
  const n = voters().length;
  const e = state.event;
  const open = !e.routes?.length && Date.now() < new Date(e.votes_close_at).getTime();
  const late = state.signups.filter((s) => !s.walk_in && !s.distance).length;
  const when = fmtDate(e.votes_close_at, { weekday: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  $("#votes", root).innerHTML = `<div class="vote-status ${open ? "open" : ""}">${open
      ? `<b>Votación abierta</b> hasta el ${esc(when)} · ${esc(untilText(e.votes_close_at))}`
      : `<b>Votación cerrada</b> ${e.routes?.length && Date.now() < new Date(e.votes_close_at).getTime() ? "al publicar la ruta" : `desde el ${esc(when)}`}: estos votos son los definitivos.`}</div>
    <p class="chart-note">${n ? `${n} ${n === 1 ? "persona ha votado" : "personas han votado"}.` : "Aún no ha votado nadie: la propuesta usa valores por defecto."}${late ? ` ${late} ${late === 1 ? "se apuntó" : "se apuntaron"} después del cierre, sin votar.` : ""}</p>
    ${bars("Distancia", distanceOptions(maxKm()), "distance")}
    ${bars("Intensidad", INTENSITIES, "intensity")}
    ${bars("Ritmo", PACES, "pace")}`;
  const p = proposal();
  const t = (km, pace) => Math.round(km * PACES[pace].minPerKm);
  $("#proposal", root).innerHTML = `<span class="eyebrow">Propuesta</span>
    ${p.two
      ? `<p><b>Dos recorridos</b>, porque los votos están divididos. Corta de <b>${kmText(p.km[0])} km</b> para los ritmos tranquilo y medio (≈ ${t(p.km[0], "tranquilo")} min a ritmo tranquilo) y larga de <b>${kmText(p.km[1])} km</b> para el rápido (≈ ${t(p.km[1], "rapido")} min). Así llegáis casi a la vez al post-run.</p>`
      : `<p>Una ruta de <b>${kmText(p.km[0])} km</b>, intensidad <b>${INTENSITIES[p.intensity].label.toLowerCase()}</b>${n ? " (la mediana y lo más votado)" : ""}.</p>`}
    <button class="btn-line small" type="button" id="use-proposal">Usar propuesta</button>`;
}

function untilText(iso) {
  const min = Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return d ? `quedan ${d} d ${h} h` : h ? `quedan ${h} h ${m} min` : `quedan ${m} min`;
}

const snap = (km) => Math.min(maxKm(), Math.max(MIN_KM, Math.round(km * 2) / 2));
function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
}

// Distancia = mediana de los tramos votados (los extremos no la arrastran); intensidad = la más votada.
// Si al menos un 30 % quiere corta y otro 30 % larga, se proponen dos recorridos.
function proposal() {
  const opts = distanceOptions(maxKm());
  const mid = (k) => (opts[k].min + opts[k].max) / 2;
  const list = voters();
  const sized = list.filter((s) => s.distance !== "igual");
  const count = (k, v) => list.filter((s) => s[k] === v).length;
  const intensity = Object.keys(INTENSITIES).reduce((best, k) => (count("intensity", k) > count("intensity", best) ? k : best), "medio");
  const share = (k) => (sized.length ? sized.filter((s) => s.distance === k).length / sized.length : 0);
  if (sized.length >= 6 && share("corta") >= 0.3 && share("larga") >= 0.3) {
    const short = snap(median(sized.filter((s) => s.distance !== "larga").map((s) => mid(s.distance))));
    const long = snap(median(sized.filter((s) => s.distance === "larga").map((s) => mid(s.distance))));
    if (long - short >= 1.5) return { two: true, km: [short, long], intensity };
  }
  const m = median(sized.map((s) => mid(s.distance)));
  return { two: false, km: [snap(m ?? maxKm() * 0.7)], intensity };
}

function applyProposal(notify = true) {
  const p = proposal();
  ui.two = p.two;
  ui.slot = 0;
  p.km.forEach((km, i) => Object.assign(ui.slots[i], { km, intensity: p.intensity }));
  if (p.two) ui.slots[1].intensity = p.intensity;
  ui.candidates = [];
  ui.preview = null;
  syncControls();
  renderCandidates();
  renderPublish();
  showOnMap();
  if (notify) toast("Propuesta aplicada: dale a Generar");
}

// ---------- Generador ----------
function syncControls() {
  if (!root) return;
  $("#gen-two", root).checked = ui.two;
  $("#gen-slots", root).hidden = !ui.two;
  $("#gen-slots", root).querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(Number(b.dataset.slot) === ui.slot)));
  const s = slot();
  const range = $("#gen-km", root);
  range.max = maxKm();
  s.km = Math.min(s.km, maxKm());
  range.value = s.km;
  $("#gen-km-label", root).textContent = `${kmText(s.km, s.km % 1 ? 1 : 0)} km`;
  $("#gen-intensity", root).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === s.intensity)));
  $("#gen-prefer", root).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === s.prefer)));
  const input = $("#gen-people", root);
  if (document.activeElement !== input) input.value = people();
  peopleHint();
  $("#gen-run", root).disabled = ui.busy;
}

async function generate() {
  const s = slot();
  ui.busy = true;
  syncControls();
  const progress = $("#gen-progress", root);
  progress.hidden = false;
  try {
    const { candidates } = await plan({
      targetKm: s.km, intensity: s.intensity, prefer: s.prefer, maxKm: maxKm(), people: people(),
      onProgress: (msg, p) => { progress.textContent = `${msg} · ${Math.round(p * 100)}%`; },
    });
    ui.candidates = candidates;
    ui.preview = 0;
    progress.hidden = true;
  } catch (e) {
    progress.textContent = e.message || "No se pudo generar. Vuelve a intentarlo.";
  } finally {
    ui.busy = false;
    syncControls();
    renderCandidates();
    showOnMap();
  }
}

function surfacePct(c) {
  return c.surface ? Math.round((c.surface.parque ?? 0) + (c.surface.tierra ?? 0)) : null;
}

function renderCandidates() {
  const box = $("#candidates", root);
  if (!ui.candidates.length) {
    box.innerHTML = '<p class="note">Genera para ver cuatro bucles distintos que salen y vuelven a Noviciado.</p>';
    return;
  }
  box.innerHTML = ui.candidates.map((c, i) => {
    const chosen = slot().chosen?.id === c.id;
    const park = surfacePct(c);
    return `<div class="candidate ${ui.preview === i ? "on" : ""} ${chosen ? "chosen" : ""}" data-c="${i}">
      <div><b>${esc(c.name)}</b>
        <small>${kmText(c.km, 2)} km · ${c.gain != null ? `+${Math.round(c.gain)} m` : "sin desnivel"}${park != null ? ` · ${park}% parque` : ""}${i === 0 ? " · la mejor" : ""}</small>
        ${c.crossings != null ? `<small class="group-stats">${c.crossings} cruces · ${Math.round(c.narrow)}% calle estrecha · ${Math.round(c.traffic)}% junto a avenidas</small>` : ""}</div>
      <button type="button" class="${chosen ? "btn-gold" : "btn-line"} small" data-choose>${chosen ? "Elegida" : "Elegir"}</button>
    </div>`;
  }).join("");
}

function showOnMap() {
  if (!routeMap) return;
  const c = ui.preview != null ? ui.candidates[ui.preview] : null;
  const shown = c ? [toPublic(c, 0)] : ui.slots.slice(0, ui.two ? 2 : 1).filter((s) => s.chosen).map((s, i) => toPublic(s.chosen, i));
  routeMap.show(shown, 0);
}

// ---------- Publicar ----------
const r5 = (n) => Math.round(n * 1e5) / 1e5;

// Lo que se guarda y ve la web: el trazado cada 20 m y los datos para la ficha
function toPublic(c, i) {
  const label = ui.two ? (i === 0 ? "Corta" : "Larga") : "Ruta";
  const minutes = ui.two
    ? (i === 0 ? [c.km * 5.5, c.km * 6.5] : [c.km * 4.5, c.km * 5.25])
    : c.minutes;
  return {
    label,
    name: c.name,
    km: Math.round(c.km * 100) / 100,
    gain: c.gain != null ? Math.round(c.gain) : null,
    minutes: minutes.map((m) => Math.round(m)),
    intensity: c.intensity,
    prefer: c.prefer,
    pace: ui.two && i === 1 ? "rapido" : null,
    surface: c.surface ? Object.fromEntries(Object.entries(c.surface).map(([k, v]) => [k, Math.round(v)])) : null,
    people: c.people ?? null,
    crossings: c.crossings ?? null,
    narrow: c.narrow != null ? Math.round(c.narrow) : null,
    traffic: c.traffic != null ? Math.round(c.traffic) : null,
    landmarks: (c.landmarks ?? []).map((l) => l.name),
    urlPoints: (c.urlPoints ?? []).map(([a, b]) => [r5(a), r5(b)]),
    coords: (c.samples ?? c.coords).map(([a, b]) => [r5(a), r5(b)]),
  };
}

function renderPublish() {
  if (!root || !state.event) return;
  const e = state.event;
  const needed = ui.slots.slice(0, ui.two ? 2 : 1);
  const ready = needed.every((s) => s.chosen);
  const published = e.routes?.length
    ? `<p class="chart-note">En la web desde el ${esc(fmtDate(e.routes_published_at, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }))}:
        ${e.routes.map((r) => `<b>${esc(r.label)}</b> ${kmText(r.km, 2)} km`).join(" · ")}</p>`
    : '<p class="chart-note">Todavía no hay ninguna ruta publicada para este evento.</p>';
  const pending = needed.map((s, i) => {
    const name = ui.two ? (i === 0 ? "Corta" : "Larga") : "Ruta";
    return `<li>${name}: ${s.chosen ? `<b>${esc(s.chosen.name)}</b> · ${kmText(s.chosen.km, 2)} km` : '<span class="muted">sin elegir</span>'}</li>`;
  }).join("");
  $("#publish", root).innerHTML = `
    <div>
      <span class="eyebrow">Publicar</span>
      <h2>En la web</h2>
      ${published}
      <ul class="chosen-list">${pending}</ul>
    </div>
    <div class="publish-actions">
      ${e.routes?.length ? '<button class="btn-ghost" type="button" id="unpublish-btn">Retirar de la web</button>' : ""}
      <button class="btn-gold" type="button" id="publish-btn" ${ready ? "" : "disabled"}>${e.routes?.length ? "Sustituir la ruta publicada" : "Publicar en la web"}</button>
    </div>`;
}

async function publish() {
  const e = state.event;
  if (!e.routes?.length && Date.now() < new Date(e.votes_close_at).getTime()
    && !confirm(`La votación sigue abierta (${untilText(e.votes_close_at)}). Si publicas ahora, se cierra y los que se apunten ya no votarán. ¿Publicar?`)) return;
  const routes = ui.slots.slice(0, ui.two ? 2 : 1).map((s, i) => toPublic(s.chosen, i));
  try {
    await api(`/events/${encodeURIComponent(state.event.slug)}/routes`, { method: "PUT", body: JSON.stringify({ routes }) });
    await reloadEvents();
    renderPublish();
    toast(routes.length > 1 ? "Rutas publicadas en la web" : "Ruta publicada en la web");
  } catch (e) {
    if (e.message !== "unauthorized") toast(e.message, "err");
  }
}

async function unpublish() {
  if (!confirm("¿Quitar la ruta de la web? Podrás volver a publicarla.")) return;
  try {
    await api(`/events/${encodeURIComponent(state.event.slug)}/routes`, { method: "PUT", body: JSON.stringify({ routes: null }) });
    await reloadEvents();
    renderPublish();
    toast("Ruta retirada de la web");
  } catch (e) {
    if (e.message !== "unauthorized") toast(e.message, "err");
  }
}
