// Panel de administración del run club: login, inscritos y envío de correos.
// Se monta dentro de la misma app; se entra con el botón de cuenta o con #admin.

const API = `${location.protocol}//${location.hostname}:8002/api/admin`;
const TOKEN_KEY = "nrc:admin-token";

const PACES = {
  tranquilo: { label: "Tranquilo", color: "#f3dca0" },
  medio: { label: "Medio", color: "#d9b56a" },
  rapido: { label: "Rápido", color: "#9c7a3c" },
};

const state = {
  token: readToken(),
  user: null,
  events: [],
  event: null,
  signups: [],
  templates: [],
  query: "",
  pace: "all",
  selected: new Set(),
};

const $ = (sel, root = document) => root.querySelector(sel);

// Los nombres vienen de un formulario público: siempre escapados antes de meterlos en HTML
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function saveToken(token) {
  state.token = token;
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch {}
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
  });
  if (res.status === 401) {
    saveToken(null);
    leaveAdmin();
    openLogin("Tu sesión ha caducado. Vuelve a entrar.");
    throw new Error("unauthorized");
  }
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) throw Object.assign(new Error(body?.message ?? "Error"), { status: res.status, body });
  return body;
}

// ---------- Marcado ----------

const icons = {
  user: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  logout: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>',
  mail: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/></svg>',
  public: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 5l-7 7 7 7"/></svg>',
};

function mount() {
  // Botón de cuenta en la cabecera
  const pill = $(".topbar .pill");
  const right = document.createElement("div");
  right.className = "topbar-right";
  pill.replaceWith(right);
  right.append(pill);
  right.insertAdjacentHTML("beforeend", `<button class="account-btn" type="button" id="account-btn" aria-label="Cuenta de administrador">${icons.user}</button>`);

  document.body.insertAdjacentHTML("beforeend", `
    <section id="admin" aria-label="Panel de administración">
      <div class="admin">
        <header class="admin-head">
          <div>
            <span class="eyebrow">Panel · Run Club</span>
            <h1 class="gold-text" id="admin-hello">Hola</h1>
          </div>
          <div class="admin-head-actions">
            <select class="select" id="admin-event" aria-label="Evento"></select>
            <button class="btn-ghost" type="button" id="admin-public">${icons.public} Web</button>
            <button class="btn-ghost" type="button" id="admin-logout">${icons.logout} Salir</button>
          </div>
        </header>

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
            <span class="col-md">Código</span>
            <span class="col-md">Se unió</span>
            <span class="col-md">Correo</span>
          </div>
          <div id="admin-list"></div>
        </section>
      </div>
    </section>

    <div class="select-bar" id="admin-select-bar">
      <span><b id="admin-sel-count">0</b> seleccionados</span>
      <div class="actions">
        <button class="link-btn" type="button" id="admin-sel-clear">Quitar</button>
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
          <div class="field">
            <input id="login-email" name="email" type="email" autocomplete="username" placeholder=" " required>
            <label for="login-email">Correo</label>
          </div>
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
  setTimeout(() => $("#login-email").focus(), 250);
}

async function enterAdmin() {
  document.body.classList.add("is-admin");
  if (location.hash !== "#admin") history.replaceState(null, "", "#admin");
  window.scrollTo(0, 0);
  try {
    const [user, events, templates] = await Promise.all([api("/me"), api("/events"), api("/emails/templates")]);
    state.user = user;
    state.events = events;
    state.templates = templates;
    $("#admin-hello").textContent = `Hola, ${user.name.split(" ")[0]}`;
    $("#admin-event").innerHTML = events.map((e) => `<option value="${esc(e.slug)}">${esc(e.title)}</option>`).join("");
    $("#admin-event").hidden = events.length < 2;
    if (events.length) await selectEvent(state.event?.slug ?? events[0].slug);
    else $("#admin-list").innerHTML = `<div class="empty"><b>No hay eventos</b>Crea uno en el backend para empezar.</div>`;
  } catch (e) {
    if (e.message !== "unauthorized") toast("No se pudo cargar el panel. ¿Está el backend arrancado?", "err");
  }
}

function leaveAdmin() {
  document.body.classList.remove("is-admin");
  $("#admin-select-bar").classList.remove("show");
  if (location.hash === "#admin") history.replaceState(null, "", location.pathname);
}

async function selectEvent(slug) {
  state.event = state.events.find((e) => e.slug === slug);
  $("#admin-event").value = slug;
  state.selected.clear();
  state.signups = await api(`/events/${encodeURIComponent(slug)}/signups`);
  render();
}

// ---------- Pintado ----------

function render() {
  renderStats();
  renderDaily();
  renderPaces();
  renderList();
}

function renderStats() {
  const e = state.event;
  const booked = state.signups.length;
  const left = Math.max(0, e.capacity - booked);
  const day = Date.now() - 24 * 3600e3;
  const recent = state.signups.filter((s) => new Date(s.created_at) > day).length;
  const mailed = state.signups.filter((s) => s.last_emailed_at).length;
  const date = new Date(e.starts_at).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });

  $("#admin-stats").innerHTML = `
    <div class="card stat">
      <span class="eyebrow">Inscritos</span>
      <b class="gold-text">${booked}</b>
      <div class="bar"><i style="width:${Math.min(100, (booked / e.capacity) * 100)}%"></i></div>
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
      <span class="eyebrow">Con correo</span>
      <b>${mailed}</b>
      <small>${booked ? Math.round((mailed / booked) * 100) : 0}% ya han recibido uno</small>
    </div>`;
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function renderDaily() {
  const days = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    days.push({ date: d, key: dayKey(d), count: 0 });
  }
  const byKey = Object.fromEntries(days.map((d) => [d.key, d]));
  state.signups.forEach((s) => {
    const day = byKey[dayKey(new Date(s.created_at))];
    if (day) day.count++;
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((n, d) => n + d.count, 0);

  const el = $("#admin-daily");
  el.setAttribute("aria-label", `${total} inscripciones en los últimos 14 días`);
  el.innerHTML = days.map((d, i) => {
    const short = d.date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    const label = i === 13 ? "Hoy" : short;
    const showLabel = i === 0 || i === 6 || i === 13;
    return `<div class="day ${d.count ? "" : "zero"} ${showLabel ? "label" : ""}">
      <span class="tip">${d.count} ${d.count === 1 ? "inscripción" : "inscripciones"} · ${short}</span>
      <i style="height:${d.count ? Math.max(4, (d.count / max) * 100) : 1.5}%"></i>
      <span>${label}</span>
    </div>`;
  }).join("");
}

function renderPaces() {
  const total = state.signups.length;
  $("#admin-paces").innerHTML = Object.entries(PACES).map(([key, p]) => {
    const n = state.signups.filter((s) => s.pace === key).length;
    const pct = total ? Math.round((n / total) * 100) : 0;
    return `<div class="pace-row">
      <header><b>${p.label}</b><span>${n} · ${pct}%</span></header>
      <div class="pace-track"><i style="width:${pct}%; background:${p.color}"></i></div>
    </div>`;
  }).join("");
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.signups.filter((s) =>
    (state.pace === "all" || s.pace === state.pace) &&
    (!q || [s.name, s.email, s.code, s.phone].some((v) => String(v).toLowerCase().includes(q)))
  );
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function relative(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return days === 1 ? "ayer" : `hace ${days} días`;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function phone(p) {
  return p.replace(/^(\+\d{2})?(\d{3})(\d{3})(\d{3})$/, (_, c, a, b, d) => `${c ? c + " " : ""}${a} ${b} ${d}`);
}

function renderList() {
  const rows = filtered();
  $("#admin-people-title").textContent = rows.length === state.signups.length
    ? `Gente que se une · ${rows.length}`
    : `${rows.length} de ${state.signups.length}`;

  if (!state.signups.length) {
    $("#admin-list").innerHTML = `<div class="empty"><b>Aún no hay nadie</b>Cuando alguien reserve plaza aparecerá aquí.</div>`;
  } else if (!rows.length) {
    $("#admin-list").innerHTML = `<div class="empty"><b>Sin resultados</b>Prueba con otra búsqueda o quita el filtro.</div>`;
  } else {
    $("#admin-list").innerHTML = rows.map((s) => {
      const sel = state.selected.has(s.id);
      const pace = PACES[s.pace]?.label ?? s.pace;
      const mail = s.last_emailed_at
        ? `<span class="mail-state sent" title="${esc(new Date(s.last_emailed_at).toLocaleString("es-ES"))}">${relative(s.last_emailed_at)}</span>`
        : `<span class="mail-state">Pendiente</span>`;
      const mailShort = s.last_emailed_at
        ? `<span class="mail-state sent">Enviado</span>`
        : `<span class="mail-state">Sin correo</span>`;
      return `<div class="person ${sel ? "selected" : ""}" data-id="${s.id}">
        <input class="tick" type="checkbox" ${sel ? "checked" : ""} aria-label="Seleccionar a ${esc(s.name)}">
        <div class="who">
          <span class="avatar" aria-hidden="true">${esc(initials(s.name))}</span>
          <div>
            <b>${esc(s.name)}</b>
            <small>${esc(s.email)}</small>
            <div class="person-meta"><span class="badge ${esc(s.pace)}">${esc(pace)}</span>${mailShort}</div>
          </div>
        </div>
        <span class="cell muted md">${esc(phone(s.phone))}</span>
        <span class="cell md"><span class="badge ${esc(s.pace)}">${esc(pace)}</span></span>
        <span class="cell md"><code>${esc(s.code)}</code></span>
        <span class="cell muted md">${relative(s.created_at)}</span>
        <span class="cell md">${mail}</span>
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
  $("#admin-select-bar").classList.toggle("show", state.selected.size > 0);
}

// ---------- Correo ----------

async function openMail() {
  const people = state.signups.filter((s) => state.selected.has(s.id));
  if (!people.length) return;

  $("#mail-count").textContent = people.length === 1 ? "1 persona" : `${people.length} personas`;
  const names = people.map((p) => p.name.split(" ")[0]);
  $("#mail-recipients").textContent = names.length <= 3
    ? names.join(", ")
    : `${names.slice(0, 3).join(", ")} y ${names.length - 3} más`;

  $("#mail-templates").innerHTML = state.templates.map((t, i) => `
    <label class="template"><input type="radio" name="template" value="${esc(t.key)}" ${i === 0 ? "checked" : ""}>
      <span><b>${esc(t.name)}</b><small>${esc(t.description)}</small></span></label>`).join("");

  showFormError($("#mail-error"), "");
  $("#mail-send").disabled = !state.templates.length;
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
  btn.textContent = "Enviando…";
  showFormError($("#mail-error"), "");

  try {
    const { sent, failed } = await api("/emails", { method: "POST", body: JSON.stringify({ template, signup_ids: ids }) });
    closeModal($("#mail-modal"));
    state.selected.clear();
    state.signups = await api(`/events/${encodeURIComponent(state.event.slug)}/signups`);
    render();
    toast(failed.length
      ? `Enviados ${sent}. Fallaron ${failed.length}: ${failed.join(", ")}`
      : `Correo enviado a ${sent} ${sent === 1 ? "persona" : "personas"}`, failed.length ? "err" : "ok");
  } catch (e) {
    if (e.message !== "unauthorized") showFormError($("#mail-error"), e.message || "No se pudo enviar.");
    btn.disabled = false;
    btn.textContent = ids.length === 1 ? "Enviar a 1 persona" : `Enviar a ${ids.length} personas`;
  }
}

// ---------- Utilidades ----------

function showFormError(el, msg) {
  el.textContent = msg;
  el.hidden = !msg;
}

let toastTimer;
function toast(msg, kind = "ok") {
  const el = $("#admin-toast");
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

function exportCsv() {
  const rows = filtered();
  const cols = ["name", "email", "phone", "pace", "code", "created_at", "last_emailed_at"];
  const head = ["Nombre", "Correo", "Teléfono", "Ritmo", "Código", "Inscrito", "Último correo"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [head, ...rows.map((r) => cols.map((c) => r[c]))].map((r) => r.map(cell).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${state.event.slug}-inscritos.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Eventos ----------

function bind() {
  $("#account-btn").addEventListener("click", () => (state.token ? enterAdmin() : openLogin()));
  $("#admin-public").addEventListener("click", leaveAdmin);
  $("#admin-logout").addEventListener("click", async () => {
    try { await api("/logout", { method: "POST" }); } catch {}
    saveToken(null);
    leaveAdmin();
    toast("Sesión cerrada");
  });
  $("#admin-event").addEventListener("change", (e) => selectEvent(e.target.value));

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#login-submit");
    btn.disabled = true;
    btn.textContent = "Entrando…";
    showFormError($("#login-error"), "");
    try {
      const { token } = await api("/login", {
        method: "POST",
        body: JSON.stringify({ email: $("#login-email").value.trim(), password: $("#login-password").value }),
      });
      saveToken(token);
      $("#login-form").reset();
      closeModal($("#login-modal"));
      enterAdmin();
    } catch (err) {
      const msg = err.status === 429 ? "Demasiados intentos. Espera un minuto." : err.status ? err.message : "No hemos podido conectar con el servidor.";
      showFormError($("#login-error"), msg);
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
  $("#mail-templates").addEventListener("change", loadPreview);
  $("#mail-send").addEventListener("click", sendMail);

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
