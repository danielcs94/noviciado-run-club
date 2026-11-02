-- Datos de ejemplo para programar en local (NUNCA en la base de datos de verdad):
--   npx wrangler d1 execute noviciado-run-club --local --file=demo.sql
-- Un evento dentro de 6 días y 16 inscritos inventados con votos variados.
INSERT INTO events (slug, title, starts_at, meeting_point, capacity, max_km)
VALUES ('demo-sunday-run', 'Sunday Run (demo)', strftime('%Y-%m-%dT08:30:00.000Z', 'now', '+6 days'),
        'Noviciado Coffee Shop, calle del Noviciado 9, Madrid', 60, 10);

INSERT INTO members (code, secret, name, email, phone, gender) VALUES
  ('NRC-DEM1', 'demo1', 'Ana López', 'demo1@example.com', '600100001', 'mujer'),
  ('NRC-DEM2', 'demo2', 'Luis Pérez', 'demo2@example.com', '600100002', 'hombre'),
  ('NRC-DEM3', 'demo3', 'Marta Gil', 'demo3@example.com', '600100003', NULL),
  ('NRC-DEM4', 'demo4', 'Carlos Ruiz', 'demo4@example.com', '600100004', 'hombre'),
  ('NRC-DEM5', 'demo5', 'Lucía Martín', 'demo5@example.com', '600100005', 'mujer'),
  ('NRC-DEM6', 'demo6', 'Pablo Sanz', 'demo6@example.com', '600100006', 'hombre'),
  ('NRC-DEM7', 'demo7', 'Elena Torres', 'demo7@example.com', '600100007', 'mujer'),
  ('NRC-DEM8', 'demo8', 'Jorge Díaz', 'demo8@example.com', '600100008', NULL),
  ('NRC-DEM9', 'demo9', 'Sara Romero', 'demo9@example.com', '600100009', 'mujer'),
  ('NRC-DEMA', 'demo10', 'Iván Navarro', 'demo10@example.com', '600100010', 'hombre'),
  ('NRC-DEMB', 'demo11', 'Paula Gómez', 'demo11@example.com', '600100011', 'mujer'),
  ('NRC-DEMC', 'demo12', 'Diego Castro', 'demo12@example.com', '600100012', 'otro'),
  ('NRC-DEMD', 'demo13', 'Nerea Ortiz', 'demo13@example.com', '600100013', 'mujer'),
  ('NRC-DEME', 'demo14', 'Álvaro Moreno', 'demo14@example.com', '600100014', 'hombre'),
  ('NRC-DEMF', 'demo15', 'Irene Vidal', 'demo15@example.com', '600100015', NULL),
  ('NRC-DEMG', 'demo16', 'Hugo Serrano', 'demo16@example.com', '600100016', 'hombre');

WITH v(code, pace, intensity, distance, ago) AS (VALUES
  ('NRC-DEM1', 'medio', 'suave', 'corta', 3), ('NRC-DEM2', 'rapido', 'avanzado', 'larga', 20),
  ('NRC-DEM3', 'tranquilo', 'medio', 'igual', 30), ('NRC-DEM4', 'tranquilo', 'suave', 'corta', 50),
  ('NRC-DEM5', 'medio', 'suave', 'corta', 70), ('NRC-DEM6', 'rapido', 'avanzado', 'larga', 75),
  ('NRC-DEM7', 'medio', 'medio', 'media', 100), ('NRC-DEM8', 'rapido', 'medio', 'larga', 120),
  ('NRC-DEM9', 'tranquilo', 'suave', 'corta', 125), ('NRC-DEMA', 'rapido', 'avanzado', 'larga', 150),
  ('NRC-DEMB', 'medio', 'medio', 'corta', 170), ('NRC-DEMC', 'medio', 'medio', 'larga', 200),
  ('NRC-DEMD', 'tranquilo', 'suave', 'igual', 210), ('NRC-DEME', 'rapido', 'medio', 'larga', 1),
  ('NRC-DEMF', 'medio', 'suave', 'media', 5), ('NRC-DEMG', 'medio', 'medio', 'corta', 9)
)
INSERT INTO signups (event_id, member_id, pace, intensity, distance, created_at)
SELECT (SELECT id FROM events WHERE slug = 'demo-sunday-run'), m.id, v.pace, v.intensity, v.distance,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || v.ago || ' hours')
FROM v JOIN members m ON m.code = v.code;
