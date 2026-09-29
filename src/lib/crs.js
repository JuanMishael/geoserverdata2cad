import proj4 from 'proj4';

// Projected systems commonly used for Philippine utility drawings.
// AutoCAD has no reprojection in plain AutoCAD, so the DXF must already be in metres.
export const CRS_OPTIONS = [
  { code: 'EPSG:32651', label: 'WGS 84 / UTM zone 51N (most of PH)', def: '+proj=utm +zone=51 +datum=WGS84 +units=m +no_defs' },
  { code: 'EPSG:32650', label: 'WGS 84 / UTM zone 50N (Palawan, west)', def: '+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs' },
  ...[1, 2, 3, 4, 5].map((z) => ({
    code: `EPSG:${3120 + z}`,
    label: `PRS92 / Philippines zone ${['I', 'II', 'III', 'IV', 'V'][z - 1]}${z === 3 ? ' (Metro Manila, Luzon)' : ''}`,
    def: `+proj=tmerc +lat_0=0 +lon_0=${115 + 2 * z} +k=0.99995 +x_0=500000 +y_0=0 +ellps=clrk66 +towgs84=-127.62,-67.24,-47.04,-3.068,4.903,1.578,-1.06 +units=m +no_defs`,
  })),
];

CRS_OPTIONS.forEach((c) => proj4.defs(c.code, c.def));

export function isKnownCrs(code) {
  return !!code && !!proj4.defs(code);
}

/** Reads the CRS GeoServer puts in GeoJSON, e.g. "urn:ogc:def:crs:EPSG::32651" or "EPSG:4326". */
export function crsFromGeoJSON(fc) {
  const name = fc?.crs?.properties?.name;
  if (!name) return null;
  const m = String(name).match(/EPSG[:/]+(?:[\d.]*:)?(\d+)/i);
  if (m) return `EPSG:${m[1]}`;
  if (/CRS84/i.test(name)) return 'EPSG:4326';
  return null;
}

function eachCoord(geom, fn) {
  if (!geom) return;
  const walk = (c) => {
    if (typeof c[0] === 'number') fn(c);
    else c.forEach(walk);
  };
  if (geom.type === 'GeometryCollection') geom.geometries.forEach((g2) => eachCoord(g2, fn));
  else if (geom.coordinates) walk(geom.coordinates);
}

function mapCoords(geom, fn) {
  if (!geom) return geom;
  const walk = (c) => (typeof c[0] === 'number' ? fn(c) : c.map(walk));
  if (geom.type === 'GeometryCollection') return { ...geom, geometries: geom.geometries.map((g2) => mapCoords(g2, fn)) };
  return { ...geom, coordinates: walk(geom.coordinates) };
}

function sampleCoords(fc, limit = 200) {
  const pts = [];
  for (const f of fc.features || []) {
    eachCoord(f.geometry, (c) => pts.length < limit && pts.push(c));
    if (pts.length >= limit) break;
  }
  return pts;
}

export function looksGeographic(fc) {
  const pts = sampleCoords(fc);
  return pts.length > 0 && pts.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 180);
}

/**
 * Normalises a WFS GeoJSON response into the target CRS.
 * Returns { fc, sourceCrs, notes: [{level, text}] }.
 */
export function prepareFeatureCollection(fc, targetCrs) {
  const notes = [];
  let sourceCrs = crsFromGeoJSON(fc);
  const geographic = looksGeographic(fc);
  if (!sourceCrs && geographic) {
    sourceCrs = 'EPSG:4326';
    notes.push({ level: 'info', text: 'No CRS in response; coordinates look like lon/lat, assuming EPSG:4326.' });
  }

  let data = fc;
  if (sourceCrs === 'EPSG:4326' || sourceCrs === 'EPSG:4258') {
    // Some servers emit lat/lon order. In PH, longitude (~116-127) is always > 90, so it's easy to spot.
    const pts = sampleCoords(fc);
    if (pts.length && pts.every(([x, y]) => Math.abs(x) <= 90 && Math.abs(y) > 90)) {
      data = { ...data, features: data.features.map((f) => ({ ...f, geometry: mapCoords(f.geometry, ([a, b, ...r]) => [b, a, ...r]) })) };
      notes.push({ level: 'warn', text: 'Coordinates were in lat/lon order; swapped to lon/lat.' });
    }
    sourceCrs = 'EPSG:4326';
  }

  if (sourceCrs && sourceCrs !== targetCrs) {
    if (isKnownCrs(sourceCrs) && isKnownCrs(targetCrs)) {
      const tr = proj4(sourceCrs, targetCrs);
      data = {
        ...data,
        features: data.features.map((f) => ({ ...f, geometry: mapCoords(f.geometry, ([x, y, ...r]) => [...tr.forward([x, y]), ...r]) })),
      };
      notes.push({ level: 'info', text: `Reprojected in browser: ${sourceCrs} → ${targetCrs}.` });
    } else {
      notes.push({ level: 'warn', text: `Data is in ${sourceCrs}, which this tool can't reproject. Ask GeoServer for ${targetCrs} instead.` });
    }
  } else if (!sourceCrs) {
    notes.push({ level: 'warn', text: `CRS unknown; assuming it's already ${targetCrs}.` });
  }

  if (looksGeographic(data)) {
    notes.push({ level: 'error', text: 'Coordinates still look like degrees. In AutoCAD everything would collapse near 0,0.' });
  }
  return { fc: data, sourceCrs, notes };
}
