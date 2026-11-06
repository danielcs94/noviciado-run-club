// Traducciones de la web pública (portada, formulario, cuenta y tarjeta). El panel de admin va en español.
// Cada idioma está en js/i18n/<código>.js y solo se descarga el que se usa; lo que falte sale en español.
import es from "./i18n/es.js";

export const LANGS = [
  { code: "en", label: "English", locale: "en-GB" },
  { code: "es", label: "Español", locale: "es-ES" },
  { code: "fr", label: "Français", locale: "fr-FR" },
  { code: "it", label: "Italiano", locale: "it-IT" },
  { code: "de", label: "Deutsch", locale: "de-DE" },
  { code: "hr", label: "Hrvatski", locale: "hr-HR" },
  { code: "pt", label: "Português", locale: "pt-PT" },
  { code: "ru", label: "Русский", locale: "ru-RU" },
  { code: "ar", label: "العربية", locale: "ar", rtl: true },
];

const KEY = "nrc:lang";

// El que eligió; si no, el del navegador si lo tenemos; si no, español
function pick() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  if (LANGS.some((l) => l.code === saved)) return saved;
  for (const n of navigator.languages ?? [navigator.language]) {
    const code = String(n).slice(0, 2).toLowerCase();
    if (LANGS.some((l) => l.code === code)) return code;
  }
  return "es";
}

export const lang = pick();
export const current = LANGS.find((l) => l.code === lang);

let dict = es;
if (lang !== "es") {
  try { dict = { ...es, ...(await import(`./i18n/${lang}.js`)).default }; } catch { dict = es; }
}

// t("clave", { n: 3 }) → texto con {n} sustituido
export function t(key, vars = {}) {
  const s = dict[key] ?? es[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

// Mensajes del servidor (vienen en español): si tenemos su traducción, la usamos
export function tServer(msg) {
  return (msg && dict[`srv:${msg}`]) || msg;
}

export const fmtDate = (iso, opts) => new Date(iso).toLocaleString(current.locale, { timeZone: "Europe/Madrid", ...opts });

// Textos fijos del HTML: data-i18n (texto), data-i18n-html (con etiquetas) y data-i18n-attr="aria-label:clave"
export function applyStatic(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":");
      el.setAttribute(attr, t(key));
    }
  });
}

export function setLang(code) {
  try { localStorage.setItem(KEY, code); } catch {}
  location.reload(); // así todo (evento, fechas, cuenta) se vuelve a pintar en el idioma nuevo
}

// Selector de la cabecera: el idioma actual y la lista al pulsar
export function mountLangSwitch(box) {
  if (!box) return;
  box.innerHTML = `
    <button class="lang-btn" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Language">
      <span class="lang-name">${current.label}</span><span class="lang-code">${current.code.toUpperCase()}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <ul class="lang-list" role="listbox" hidden>
      ${LANGS.map((l) => `<li role="option" aria-selected="${l.code === lang}" data-lang="${l.code}" lang="${l.code}"${l.rtl ? ' dir="rtl"' : ""}>${l.label}${l.code === lang ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>' : ""}</li>`).join("")}
    </ul>`;
  const btn = box.querySelector(".lang-btn");
  const list = box.querySelector(".lang-list");
  const toggle = (open) => { list.hidden = !open; btn.setAttribute("aria-expanded", String(open)); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(list.hidden); });
  list.addEventListener("click", (e) => {
    const li = e.target.closest("[data-lang]");
    if (!li) return;
    toggle(false);
    if (li.dataset.lang !== lang) setLang(li.dataset.lang);
  });
  document.addEventListener("click", () => toggle(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggle(false); });
}

document.documentElement.lang = lang;
document.documentElement.dir = current.rtl ? "rtl" : "ltr";
