// Mapa de rutas del club (MapLibre + OpenFreeMap, sin API key), en oscuro y con la ruta en dorado.
// Lo usan la web pública (ruta publicada) y el panel (vista previa de las rutas generadas).
/* global maplibregl */
import { ORIGIN } from "./rutas/config.js";
import { appleStyle, LAND } from "./rutas/mapstyle.js";

const ll = ([lat, lon]) => [lon, lat];
const GOLD = "#e3c27a";
const DIM = "#6f6248";

function pin(cls, html, title) {
  const d = document.createElement("div");
  d.className = `pin ${cls}`;
  d.innerHTML = html;
  if (title) d.title = title;
  return d;
}

export function createRouteMap(container) {
  let routes = [];
  let active = 0;
  let markers = [];

  const map = new maplibregl.Map({
    container,
    style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": LAND.dark } }] },
    center: ll([ORIGIN.lat, ORIGIN.lon]),
    zoom: 13.5,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    cooperativeGestures: matchMedia("(pointer: coarse)").matches, // en el móvil, dos dedos para mover: así no atrapa el scroll
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  // La atribución empieza plegada (botón "i"): desplegada tapa media franja del mapa en el móvil
  map.once("load", () => container.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
  new maplibregl.Marker({ element: pin("pin-origin", "☕", `${ORIGIN.name} · ${ORIGIN.address}`) })
    .setLngLat(ll([ORIGIN.lat, ORIGIN.lon])).addTo(map);
  appleStyle("dark").then((style) => map.setStyle(style, { diff: false }));

  map.on("style.load", () => {
    map.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "route-casing", type: "line", source: "routes",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#0b0b0c", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 7, 17, 14], "line-opacity": ["get", "opacity"] },
    });
    map.addLayer({
      id: "route-line", type: "line", source: "routes",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3.5, 17, 7] },
    });
    render();
    // El estilo de OpenFreeMap trae su propio encuadre: se vuelve a encuadrar la ruta
    if (routes[active]) api.fit(0);
  });

  function render() {
    const src = map.getSource("routes");
    if (!src) return;
    // La ruta activa va encima y en dorado; la otra, apagada debajo
    const order = routes.map((r, i) => i).sort((a, b) => (a === active) - (b === active));
    src.setData({
      type: "FeatureCollection",
      features: order.map((i) => ({
        type: "Feature",
        properties: { color: i === active ? GOLD : DIM, opacity: i === active ? 1 : 0.5 },
        geometry: { type: "LineString", coordinates: routes[i].coords.map(ll) },
      })),
    });
    markers.forEach((m) => m.remove());
    markers = [];
    const r = routes[active];
    if (!r) return;
    // Un marcador por kilómetro, a partir de la distancia acumulada del trazado
    let acc = 0, next = 1;
    for (let i = 1; i < r.coords.length; i++) {
      acc += dist(r.coords[i - 1], r.coords[i]);
      if (acc >= next * 1000 && acc < r.km * 1000 - 150) {
        markers.push(new maplibregl.Marker({ element: pin("pin-km", next, `Km ${next}`) }).setLngLat(ll(r.coords[i])).addTo(map));
        next++;
      }
    }
  }

  const api = {
    map,
    show(list, index = 0) {
      routes = list ?? [];
      active = index;
      render();
      if (routes[active]) this.fit();
    },
    select(index) {
      active = index;
      render();
      this.fit();
    },
    fit(duration = 400) {
      const r = routes[active];
      if (!r) return;
      const b = r.coords.reduce((acc, p) => acc.extend(ll(p)), new maplibregl.LngLatBounds(ll(r.coords[0]), ll(r.coords[0])));
      map.resize();
      map.fitBounds(b, { padding: 36, duration });
    },
  };
  return api;
}

function dist([a, b], [c, d]) {
  const R = 6371000, rad = Math.PI / 180;
  const x = (d - b) * rad * Math.cos(((a + c) / 2) * rad), y = (c - a) * rad;
  return Math.sqrt(x * x + y * y) * R;
}

// Google Maps a pie con los mismos puntos de paso del generador (comas y "|" codificados: si no, error 400)
export function googleMapsUrl(r) {
  const fmt = ([a, b]) => `${a.toFixed(6)},${b.toFixed(6)}`;
  const o = fmt([ORIGIN.lat, ORIGIN.lon]);
  const params = new URLSearchParams({ api: "1", origin: o, destination: o, travelmode: "walking", waypoints: (r.urlPoints ?? []).slice(0, 3).map(fmt).join("|") });
  return `https://www.google.com/maps/dir/?${params}`;
}

export function downloadGpx(r, title) {
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
  const pts = r.coords.map(([a, b]) => `      <trkpt lat="${a.toFixed(6)}" lon="${b.toFixed(6)}"/>`).join("\n");
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Noviciado Run Club" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${esc(title)}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>
`;
  const url = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${title.toLowerCase().normalize("NFD").replace(/[^\w]+/g, "-")}.gpx` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
