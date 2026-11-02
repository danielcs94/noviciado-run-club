// Reglas del club que comparten la API, los correos y Google Wallet.
// (La web tiene una copia de LEVELS en js/club.js: si cambias una, cambia la otra.)

export const CHECKIN_POINTS = 10;

export const LEVELS = [
  { key: 'novicio', name: 'Novicio', from: 0 },
  { key: 'habitual', name: 'Habitual', from: 50 },
  { key: 'fondista', name: 'Fondista', from: 150 },
  { key: 'leyenda', name: 'Leyenda', from: 400 },
] as const;

export function levelFor(points: number) {
  let i = 0;
  while (i + 1 < LEVELS.length && points >= LEVELS[i + 1].from) i++;
  return { ...LEVELS[i], next: LEVELS[i + 1] ?? null };
}

export const PACES = ['tranquilo', 'medio', 'rapido'] as const;
export const INTENSITIES = ['suave', 'medio', 'avanzado'] as const;
export const DISTANCES = ['corta', 'media', 'larga', 'igual'] as const;
export const GENDERS = ['mujer', 'hombre', 'otro'] as const;

export const MIN_KM = 3;
export const MAX_EVENT_KM = 15; // lo que cubren los datos de superficie y desnivel alrededor del café
