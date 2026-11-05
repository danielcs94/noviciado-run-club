// Reglas del club que usan la web y el panel. Los niveles están también en api/src/club.ts.

export const MIN_KM = 3;
export const CHECKIN_POINTS = 10;

export const LEVELS = [
  { key: "novicio", name: "Novicio", from: 0 },
  { key: "habitual", name: "Habitual", from: 50 },
  { key: "fondista", name: "Fondista", from: 150 },
  { key: "leyenda", name: "Leyenda", from: 400 },
];

export function levelFor(points) {
  let i = 0;
  while (i + 1 < LEVELS.length && points >= LEVELS[i + 1].from) i++;
  return { ...LEVELS[i], next: LEVELS[i + 1] ?? null };
}

// Minutos por km de cada grupo (el del medio de su horquilla)
export const PACES = {
  tranquilo: { label: "Tranquilo", hint: "+6:00 /km", minPerKm: 6.5 },
  medio: { label: "Medio", hint: "5:00–6:00", minPerKm: 5.5 },
  rapido: { label: "Rápido", hint: "−5:00 /km", minPerKm: 4.75 },
};

// Las claves son las intensidades del generador de rutas (js/rutas/config.js)
export const INTENSITIES = {
  suave: { label: "Suave", hint: "Llana, por parques, para charlar" },
  medio: { label: "Con chicha", hint: "Alguna cuesta por el camino" },
  avanzado: { label: "Dura", hint: "Busca las cuestas" },
};

export const GENDERS = {
  mujer: "Mujer",
  hombre: "Hombre",
  otro: "Otro",
};

// Tramos de distancia del cuestionario: el rango del evento (3 km → máximo) partido en tres,
// en kilómetros enteros para que se entiendan a la primera (3–5, 5–8, 8–10).
// Solo con un máximo muy corto (menos de 6 km) hacen falta medios kilómetros.
export function distanceOptions(maxKm) {
  const step = maxKm - MIN_KM >= 3 ? 1 : 0.5;
  const r = (n) => Math.round(n / step) * step;
  const a = r(MIN_KM + (maxKm - MIN_KM) / 3);
  const b = r(MIN_KM + (2 * (maxKm - MIN_KM)) / 3);
  const km = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
  return {
    corta: { label: `${km(MIN_KM)}–${km(a)} km`, hint: "Corta", min: MIN_KM, max: a },
    media: { label: `${km(a)}–${km(b)} km`, hint: "Media", min: a, max: b },
    larga: { label: `${km(b)}–${km(maxKm)} km`, hint: "Larga", min: b, max: maxKm },
    igual: { label: "Me da igual", hint: "Lo que salga", min: null, max: null },
  };
}

export const kmText = (n, digits = 1) => n.toFixed(digits).replace(".", ",");
