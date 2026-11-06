// Cuenta de socio: se crea al apuntarse (correo + contraseña). Desde el icono de arriba a la derecha
// el socio ve su tarjeta con el QR, sus puntos, sus datos y sus carreras, desde cualquier móvil.
/* global qrcode */
import { API, esc } from "./config.js";
import { CHECKIN_POINTS } from "./club.js";
import { fmtDate, t, tServer } from "./i18n.js";

const TOKEN_KEY = "nrc:member-token";
const CARD_KEY = "nrc:card";
const $ = (sel, root = document) => root.querySelector(sel);

let account = null;   // datos de la cuenta abierta
let options = {};     // { admin: bool, onAdmin(), onAdminLogin() } que pasa el panel

// ---------- Sesión ----------
export function memberToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function saveSession(token, card) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(CARD_KEY); } // al salir no queda nada en el móvil
    if (card) localStorage.setItem(CARD_KEY, JSON.stringify(card));
  } catch {}
  document.dispatchEvent(new CustomEvent("nrc:session"));
}

// La tarjeta guardada en este móvil (de antes de haber cuentas): sirve para activar la cuenta al apuntarse
export function savedCard() {
  try { return JSON.parse(localStorage.getItem(CARD_KEY)); } catch { return null; }
}

async function call(path, init = {}) {
  const token = memberToken();
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw Object.assign(new Error(t("f.noConnection")), { status: 0 });
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401 && token) saveSession(null);
  if (!res.ok) throw Object.assign(new Error(body?.message ? tServer(body.message) : t("f.error")), { status: res.status, body });
  return body;
}

// Para el formulario: los datos de quien tiene la sesión abierta (o null)
export async function currentAccount() {
  if (!memberToken()) return null;
  if (account) return account;
  try { account = await call("/account"); } catch { account = null; }
  return account;
}

export function forgetAccount() { account = null; }

// ---------- Ventana ----------
function mount() {
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal" id="account-modal" aria-hidden="true">
      <div class="sheet account-sheet" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <div class="sheet-head">
          <div>
            <span class="eyebrow" id="account-eyebrow">${t("acc.members")}</span>
            <h3 id="account-title">${t("acc.yours")}</h3>
          </div>
          <button class="close" type="button" data-close-account aria-label="${t("close")}">×</button>
        </div>
        <div id="account-body"></div>
      </div>
    </div>`);
  const modal = $("#account-modal");
  modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-close-account]")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

export function openAccount(opts = {}) {
  options = opts;
  const modal = $("#account-modal");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  if (memberToken()) showAccount();
  else showLogin();
}

function close() {
  const modal = $("#account-modal");
  if (!modal.classList.contains("open")) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function head(eyebrow, title) {
  $("#account-eyebrow").textContent = eyebrow;
  $("#account-title").textContent = title;
}

// ---------- Entrar ----------
function showLogin(message = "") {
  head(t("acc.members"), t("acc.loginTitle"));
  $("#account-body").innerHTML = `
    <form id="account-login" class="account-form" novalidate>
      <div class="field">
        <input id="acc-email" name="email" type="email" autocomplete="username" placeholder=" " required>
        <label for="acc-email">${t("f.email")}</label>
      </div>
      <div class="field">
        <input id="acc-password" name="password" type="password" autocomplete="current-password" placeholder=" " required>
        <label for="acc-password">${t("acc.password")}</label>
      </div>
      <p class="form-error" id="acc-error" role="alert" ${message ? "" : "hidden"}>${esc(message)}</p>
      <button class="btn-gold btn-block" type="submit" id="acc-submit">${t("acc.login")}</button>
    </form>
    <div class="account-help">
      <p><b>${t("acc.notMemberQ")}</b> ${t("acc.notMember")}</p>
      <p><b>${t("acc.forgotQ")}</b> ${t("acc.forgot")}</p>
    </div>
    <button class="link-back" type="button" id="acc-admin">${t("acc.organizer")}</button>`;
  setTimeout(() => $("#acc-email")?.focus(), 250);

  $("#acc-admin").addEventListener("click", () => { close(); options.admin ? options.onAdmin?.() : options.onAdminLogin?.(); });
  $("#account-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#acc-submit");
    const err = $("#acc-error");
    btn.disabled = true;
    btn.textContent = t("acc.loggingIn");
    err.hidden = true;
    try {
      const body = await call("/account/login", {
        method: "POST",
        body: JSON.stringify({ email: $("#acc-email").value.trim(), password: $("#acc-password").value }),
      });
      account = body.account;
      saveSession(body.token, body.account.card);
      renderAccount();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = t("acc.login");
    }
  });
}

// ---------- Cuenta ----------
async function showAccount() {
  head(t("acc.yours"), account?.name ?? "…");
  if (account) return renderAccount();
  $("#account-body").innerHTML = `<p class="note" style="padding:40px 0">${t("acc.loading")}</p>`;
  try {
    account = await call("/account");
    renderAccount();
  } catch (e) {
    if (e.status === 401) showLogin(t("acc.expired"));
    else $("#account-body").innerHTML = `<p class="note" style="padding:40px 0">${esc(e.message)}</p>`;
  }
}

function renderAccount() {
  const a = account;
  head(t("acc.yours"), a.name);
  const toNext = a.next ? a.next.from - a.points : 0;
  const pct = a.next ? Math.min(100, (a.points / a.next.from) * 100) : 100;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const cardUrl = `tarjeta.html?c=${encodeURIComponent(a.card.code)}&k=${encodeURIComponent(a.card.k)}`;
  const runs = a.runs.filter((r) => r.checked_in).length;

  $("#account-body").innerHTML = `
    <div class="member-card" data-level="${esc(a.levelKey)}">
      <div class="top">
        <div><span class="eyebrow">Noviciado Run Club</span><h4 class="gold-text">${esc(a.name)}</h4></div>
        <span class="pass-level">${esc(a.level)}</span>
      </div>
      <div class="qr" id="acc-qr" role="img" aria-label="${esc(t("acc.qrLabel", { code: a.code }))}"></div>
      <code>${esc(a.code)}</code>
      <div class="progress">
        <header><span><b>${a.points}</b> ${t("acc.points")}</span><span>${a.next ? esc(t("acc.toNext", { n: toNext, level: a.next.name, runs: Math.ceil(toNext / CHECKIN_POINTS) })) : t("acc.max")}</span></header>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>
    </div>
    <p class="hint account-tip">${t("acc.tip", { n: CHECKIN_POINTS })}</p>
    <div class="account-actions">
      <a class="btn-line" href="${cardUrl}">${t("acc.fullscreen")}</a>
      ${a.wallet && !ios ? `<button class="btn-line" type="button" id="acc-wallet">${t("done.wallet")}</button>` : ""}
    </div>

    <div class="account-stats">
      <div><b>${a.points}</b><span>${t("acc.points")}</span></div>
      <div><b>${runs}</b><span>${runs === 1 ? t("acc.run") : t("acc.runs")}</span></div>
      <div><b>${esc(a.level)}</b><span>${t("acc.level")}</span></div>
    </div>

    <section class="account-section">
      <span class="eyebrow">${t("acc.data")}</span>
      <dl class="account-data">
        <div><dt>${t("acc.name")}</dt><dd>${esc(a.name)}</dd></div>
        <div><dt>${t("acc.email")}</dt><dd>${esc(a.email)}</dd></div>
        <div><dt>${t("acc.phone")}</dt><dd dir="ltr">${esc(a.phone)}</dd></div>
        <div><dt>${t("acc.gender")}</dt><dd>${esc(a.gender ? t(`gender.${a.gender}`) : t("acc.genderNone"))}</dd></div>
        <div><dt>${t("acc.since")}</dt><dd>${esc(fmtDate(a.since, { day: "numeric", month: "long", year: "numeric" }))}</dd></div>
      </dl>
      <p class="hint">${t("acc.wrongData")}</p>
    </section>

    <section class="account-section">
      <span class="eyebrow">${t("acc.history")}</span>
      ${a.runs.length ? `<ul class="account-runs">${a.runs.map(runRow).join("")}</ul>` : `<p class="hint">${t("acc.noRuns")}</p>`}
    </section>

    <details class="account-section account-password">
      <summary>${t("acc.changePassword")}</summary>
      <form id="acc-pw" class="account-form" novalidate>
        <div class="field"><input id="acc-pw-current" type="password" autocomplete="current-password" placeholder=" " required><label for="acc-pw-current">${t("acc.currentPassword")}</label></div>
        <div class="field"><input id="acc-pw-new" type="password" autocomplete="new-password" placeholder=" " required minlength="8"><label for="acc-pw-new">${t("acc.newPassword")}</label></div>
        <p class="form-error" id="acc-pw-error" role="alert" hidden></p>
        <button class="btn-gold btn-block" type="submit" id="acc-pw-submit">${t("acc.save")}</button>
      </form>
    </details>

    <div class="account-foot">
      ${options.admin ? `<button class="link-back" type="button" id="acc-panel">${t("acc.panel")}</button>` : ""}
      <button class="link-back" type="button" id="acc-logout">${t("acc.logout")}</button>
    </div>`;

  const qr = qrcode(0, "M");
  qr.addData(a.code);
  qr.make();
  $("#acc-qr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });

  $("#acc-wallet")?.addEventListener("click", addToWallet);
  $("#acc-panel")?.addEventListener("click", () => { close(); options.onAdmin?.(); });
  $("#acc-logout").addEventListener("click", () => {
    account = null;
    saveSession(null);
    showLogin();
  });
  $("#acc-pw").addEventListener("submit", changePassword);
}

function runRow(r) {
  const past = new Date(r.starts_at).getTime() < Date.now() - 12 * 3600e3;
  const state = r.checked_in
    ? `<span class="run-ok">${t("acc.checked", { n: CHECKIN_POINTS })}</span>`
    : past ? `<span class="run-miss">${t("acc.missed")}</span>` : `<span class="run-next">${t("acc.signed")}</span>`;
  return `<li><div><b>${esc(r.title)}</b><small>${esc(fmtDate(r.starts_at, { weekday: "short", day: "numeric", month: "short", year: "numeric" }))}</small></div>${state}</li>`;
}

async function changePassword(e) {
  e.preventDefault();
  const btn = $("#acc-pw-submit");
  const err = $("#acc-pw-error");
  err.hidden = true;
  btn.disabled = true;
  try {
    const { token } = await call("/account/password", {
      method: "PUT",
      body: JSON.stringify({ current: $("#acc-pw-current").value, password: $("#acc-pw-new").value }),
    });
    saveSession(token);
    e.target.reset();
    btn.textContent = t("acc.saved");
    setTimeout(() => { btn.textContent = t("acc.save"); }, 2500);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function addToWallet(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/card/${encodeURIComponent(account.card.code)}/google?k=${encodeURIComponent(account.card.k)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.message);
    location.href = body.url;
  } catch (ex) {
    btn.textContent = t("done.walletError");
    btn.disabled = false;
  }
}

mount();
