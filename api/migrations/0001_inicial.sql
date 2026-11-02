-- Eventos: cada quedada del club. `routes` guarda las rutas publicadas (JSON) o NULL.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,              -- ISO en UTC
  meeting_point TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  max_km REAL NOT NULL DEFAULT 10,
  routes TEXT,
  routes_published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Socios: una persona = una tarjeta, aunque venga a muchos eventos.
CREATE TABLE members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,            -- NRC-XXXX, lo que lleva el QR
  secret TEXT NOT NULL,                 -- va en el enlace de la tarjeta
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  gender TEXT,                          -- mujer, hombre, otro o NULL
  points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Inscripciones a un evento, con las respuestas del cuestionario de la ruta.
CREATE TABLE signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  pace TEXT,                            -- tranquilo, medio, rapido
  intensity TEXT,                       -- suave, medio, avanzado
  distance TEXT,                        -- corta, media, larga, igual
  walk_in INTEGER NOT NULL DEFAULT 0,   -- 1 = vino sin apuntarse y se le fichó en la puerta
  checked_in_at TEXT,
  last_emailed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (event_id, member_id)
);
CREATE INDEX signups_event ON signups(event_id);

-- Límite de peticiones por IP (inscripciones y login).
CREATE TABLE hits (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX hits_key_at ON hits(key, at);
