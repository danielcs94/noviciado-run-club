-- Hasta cuándo se puede votar la ruta (ISO en UTC). NULL = 23:59 (hora de Madrid) dos días antes del evento.
ALTER TABLE events ADD COLUMN votes_close_at TEXT;
