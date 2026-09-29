// Fake "GeoServer WFS" responses so the tool can be tested without a server.
// Geometry is in EPSG:4326 (like a typical GeoServer store) around Makati / Manila.

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LAT0 = 14.5547;
const LON0 = 121.0244;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const toLonLat = (x, y) => [+(LON0 + x / M_PER_DEG_LON).toFixed(8), +(LAT0 + y / M_PER_DEG_LAT).toFixed(8)];

const CRS = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4326' } };
const fcOf = (name, features) => ({
  type: 'FeatureCollection',
  features: features.map((f, i) => ({ type: 'Feature', id: `${name}.${i + 1}`, ...f })),
  totalFeatures: features.length,
  numberMatched: features.length,
  numberReturned: features.length,
  crs: CRS,
});

export function makeSampleData() {
  const rand = rng(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const date = () => `20${10 + Math.floor(rand() * 15)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`;

  // Feeder routes in local metres: [feeder, start, direction, count]
  const routes = [
    { feeder: 'MKT-F01', start: [0, 0], dir: [1, 0.05], count: 24 },
    { feeder: 'MKT-F01', start: null, branchFrom: 9, dir: [0.08, 1], count: 12 },
    { feeder: 'MKT-F02', start: [60, -320], dir: [1, -0.03], count: 20 },
  ];

  const poles = [];
  const transformers = [];
  const lines = [];
  let poleNo = 1;
  let xfNo = 1;
  let lineNo = 1;
  const routePoles = [];

  for (const r of routes) {
    const pts = [];
    let [x, y] = r.start ?? routePoles[0][r.branchFrom].xy;
    if (!r.start) pts.push({ xy: [x, y], id: routePoles[0][r.branchFrom].id });
    for (let i = 0; i < r.count; i++) {
      if (i > 0 || !r.start) {
        const span = 35 + rand() * 10;
        const len = Math.hypot(...r.dir);
        x += (r.dir[0] / len) * span + (rand() - 0.5) * 4;
        y += (r.dir[1] / len) * span + (rand() - 0.5) * 4;
      }
      const id = `P-${String(poleNo++).padStart(4, '0')}`;
      pts.push({ xy: [x, y], id });
      poles.push({
        geometry: { type: 'Point', coordinates: toLonLat(x, y) },
        properties: {
          pole_id: id,
          feeder: r.feeder,
          material: pick(['Concrete', 'Concrete', 'Steel', 'Wood']),
          height_m: pick([10.7, 12.2, 13.7]),
          pole_class: pick(['A', 'B', 'C']),
          status: pick(['Active', 'Active', 'Active', 'For Replacement']),
          install_date: date(),
          barangay: pick(['San Antonio', 'Bel-Air', 'Poblacion', 'Sto. Niño']),
          remarks: rand() < 0.2 ? 'Leaning, needs inspection' : null,
        },
      });
      if ((poleNo - 1) % 4 === 0) {
        transformers.push({
          geometry: { type: 'Point', coordinates: toLonLat(x + 1.2, y + 1.2) },
          properties: {
            xfmr_id: `T-${String(xfNo++).padStart(4, '0')}`,
            pole_ref: id,
            kva: pick([25, 37.5, 50, 75, 100]),
            phase: pick(['1P', '1P', '3P']),
            primary_kv: 13.8,
            secondary_v: '240/120',
            brand: pick(['ABB', 'Siemens', 'Pauwels', 'Kotech']),
            serial_no: `SN${Math.floor(rand() * 1e8)}`,
            install_date: date(),
            status: pick(['Active', 'Active', 'Overloaded']),
          },
        });
      }
    }
    routePoles.push(pts);

    // Line sections of ~6 spans each
    for (let s = 0; s < pts.length - 1; s += 6) {
      const sec = pts.slice(s, Math.min(s + 7, pts.length));
      let length = 0;
      for (let k = 1; k < sec.length; k++) length += Math.hypot(sec[k].xy[0] - sec[k - 1].xy[0], sec[k].xy[1] - sec[k - 1].xy[1]);
      lines.push({
        geometry: { type: 'LineString', coordinates: sec.map((p) => toLonLat(...p.xy)) },
        properties: {
          line_id: `L-${String(lineNo++).padStart(4, '0')}`,
          feeder: r.feeder,
          voltage_kv: 13.8,
          conductor: pick(['336.4 MCM ACSR', '1/0 ACSR', '4/0 ACSR']),
          phases: pick(['ABC', 'ABC', 'AN']),
          length_m: Math.round(length * 10) / 10,
          from_pole: sec[0].id,
          to_pole: sec[sec.length - 1].id,
        },
      });
    }
  }

  const rect = (x1, y1, x2, y2) => {
    const ring = [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]].map(([x, y]) => toLonLat(x + (rand() - 0.5) * 20, y + (rand() - 0.5) * 20));
    ring[ring.length - 1] = ring[0];
    return { type: 'Polygon', coordinates: [ring] };
  };
  const areas = [
    { geometry: rect(-40, -60, 480, 120), properties: { area_id: 'SA-001', name: 'Brgy. San Antonio', substation: 'Makati SS', customer_count: 412 } },
    { geometry: rect(260, 120, 520, 520), properties: { area_id: 'SA-002', name: 'Brgy. Sto. Niño', substation: 'Makati SS', customer_count: 238 } },
    { geometry: rect(20, -420, 780, -230), properties: { area_id: 'SA-003', name: 'Brgy. Poblacion', substation: 'Guadalupe SS', customer_count: 530 } },
  ];

  return {
    'energisuite:poles': fcOf('poles', poles),
    'energisuite:transformers': fcOf('transformers', transformers),
    'energisuite:mv_lines': fcOf('mv_lines', lines),
    'energisuite:service_areas': fcOf('service_areas', areas),
  };
}
