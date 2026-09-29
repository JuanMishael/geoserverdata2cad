import { DxfR12, sanitizeName, sanitizeTag } from './dxf.js';

// A few AutoCAD Color Index (ACI) values with an approximate screen colour for the preview.
export const ACI_COLORS = [
  { aci: 1, name: 'Red', hex: '#e5484d' },
  { aci: 2, name: 'Yellow', hex: '#d4a72c' },
  { aci: 3, name: 'Green', hex: '#30a46c' },
  { aci: 4, name: 'Cyan', hex: '#0fa5b8' },
  { aci: 5, name: 'Blue', hex: '#3e63dd' },
  { aci: 6, name: 'Magenta', hex: '#c24ac4' },
  { aci: 30, name: 'Orange', hex: '#e8762c' },
  { aci: 8, name: 'Gray', hex: '#8b8d98' },
  { aci: 7, name: 'White/Black', hex: '#6f6e77' },
];
export const aciHex = (aci) => ACI_COLORS.find((c) => c.aci === Number(aci))?.hex ?? '#6f6e77';

export const SYMBOLS = ['circle-cross', 'circle', 'square', 'triangle', 'diamond', 'dot'];

export const FID_FIELD = '__fid';

function symbolPrimitives(symbol, size) {
  const r = size / 2;
  switch (symbol) {
    case 'circle':
      return [{ type: 'circle', x: 0, y: 0, r }];
    case 'square':
      return [{ type: 'polyline', closed: true, points: [[-r, -r], [r, -r], [r, r], [-r, r]] }];
    case 'triangle':
      return [{ type: 'polyline', closed: true, points: [[0, r], [r * 0.866, -r / 2], [-r * 0.866, -r / 2]] }];
    case 'diamond':
      return [{ type: 'polyline', closed: true, points: [[0, r], [r, 0], [0, -r], [-r, 0]] }];
    case 'dot':
      return [{ type: 'circle', x: 0, y: 0, r: r * 0.35 }];
    case 'circle-cross':
    default:
      return [
        { type: 'circle', x: 0, y: 0, r },
        { type: 'line', x1: -r, y1: 0, x2: r, y2: 0 },
        { type: 'line', x1: 0, y1: -r, x2: 0, y2: r },
      ];
  }
}

// ---------- geometry helpers

export function* geometryParts(geom) {
  if (!geom) return;
  const c = geom.coordinates;
  switch (geom.type) {
    case 'Point': yield { kind: 'point', coords: c }; break;
    case 'MultiPoint': for (const p of c) yield { kind: 'point', coords: p }; break;
    case 'LineString': yield { kind: 'line', coords: c }; break;
    case 'MultiLineString': for (const l of c) yield { kind: 'line', coords: l }; break;
    case 'Polygon': yield { kind: 'polygon', rings: c }; break;
    case 'MultiPolygon': for (const p of c) yield { kind: 'polygon', rings: p }; break;
    case 'GeometryCollection': for (const g2 of geom.geometries) yield* geometryParts(g2); break;
    default: break;
  }
}

export function detectGeomType(fc) {
  const kinds = new Set();
  for (const f of fc.features || []) for (const p of geometryParts(f.geometry)) kinds.add(p.kind);
  if (kinds.size === 1) return [...kinds][0];
  return kinds.size === 0 ? 'none' : 'mixed';
}

function lineMidpoint(coords) {
  let total = 0;
  const seg = [];
  for (let i = 1; i < coords.length; i++) {
    const d = Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let half = total / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? half / seg[i] : 0;
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[i + 1];
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    half -= seg[i];
  }
  return coords[0];
}

function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const sx = ring.reduce((s, p) => s + p[0], 0), sy = ring.reduce((s, p) => s + p[1], 0);
    return [sx / ring.length, sy / ring.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function stripClosingVertex(ring) {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, -1);
  return ring;
}

function valueToString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** A point guaranteed to be inside the polygon (centroids of concave shapes can fall outside). */
function interiorPoint(rings) {
  const outer = rings[0];
  const c = ringCentroid(outer);
  if (pointInRings(c, rings)) return c;
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of outer) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  let best = null, bestW = -1;
  for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9]) {
    const y = minY + (maxY - minY) * t;
    const xs = [];
    for (const ring of rings)
      for (let i = 0, n = ring.length; i < n; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % n];
        if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > bestW) { bestW = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, y]; }
    }
  }
  return best ?? c;
}

function pointInRings([px, py], rings) {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

/** Median bounding-box diagonal of the layer's features, in drawing units. */
function typicalSize(fc) {
  const sizes = [];
  for (const f of fc.features || []) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = ([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    for (const p of geometryParts(f.geometry)) {
      if (p.kind === 'line') p.coords.forEach(add);
      else if (p.kind === 'polygon') p.rings.forEach((rg) => rg.forEach(add));
    }
    if (Number.isFinite(minX)) sizes.push(Math.hypot(maxX - minX, maxY - minY));
  }
  if (!sizes.length) return 0;
  sizes.sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)];
}

// ---------- mapping defaults

const DEFAULT_STYLE = {
  point: { symbol: 'circle-cross', color: 1 },
  line: { symbol: 'dot', color: 5 },
  polygon: { symbol: 'diamond', color: 3 },
};

/** Builds an editable CAD mapping for one source layer. */
export function makeLayerMapping(sourceName, fc, notes = [], index = 0) {
  const local = String(sourceName).split(':').pop();
  const geomType = detectGeomType(fc);
  const style = DEFAULT_STYLE[geomType] ?? DEFAULT_STYLE.point;
  const palette = [1, 30, 5, 3, 6, 4, 2];

  const names = [];
  for (const f of fc.features || []) {
    for (const k of Object.keys(f.properties || {})) if (!names.includes(k)) names.push(k);
  }
  const idField = names.find((n) => /(^|_)id$/i.test(n)) ?? names[0];

  const fields = [
    { name: FID_FIELD, label: 'Feature ID (GeoServer)', tag: 'GIS_FID', include: true, visible: false },
    ...names.map((n) => ({ name: n, label: n, tag: sanitizeTag(n), include: true, visible: n === idField })),
  ];

  let symbol = style.symbol;
  if (geomType === 'point' && /xfmr|transformer/i.test(local)) symbol = 'triangle';
  else if (geomType === 'point' && /meter|switch|fuse/i.test(local)) symbol = 'square';

  const singular = local.replace(/ies$/i, 'y').replace(/s$/i, '');
  return {
    id: `${sourceName}-${Date.now()}-${index}`,
    sourceName,
    fc,
    notes,
    geomType,
    enabled: geomType !== 'none',
    cadLayer: sanitizeName(`EL-${local}`),
    color: palette[index % palette.length] ?? style.color,
    blockName: sanitizeName(geomType === 'point' ? singular : `${singular}_TAG`, 'ASSET'),
    symbol,
    fields,
  };
}

function finalTags(fields) {
  const used = new Set();
  return fields
    .filter((f) => f.include)
    .map((f) => {
      const base = sanitizeTag(f.tag || f.name);
      let t = base;
      let i = 2;
      while (used.has(t)) t = `${base.slice(0, 28)}_${i++}`;
      used.add(t);
      return { ...f, finalTag: t };
    });
}

// ---------- export

/**
 * settings: { symbolSize, textHeight, shapeMode: 'block' | 'tag' | 'none' }
 *   block – each line/polygon is its own block, so the outline itself carries the attributes
 *   tag   – plain polyline + a small tag block at a point inside the shape
 *   none  – plain polylines only
 */
export function buildCadExport(layers, settings) {
  const { symbolSize = 1.5, textHeight = 0.6 } = settings;
  const shapeMode = settings.shapeMode ?? (settings.lineTags === false ? 'none' : 'block');
  const dxf = new DxfR12();
  const csvRows = [];
  const allTags = [];
  const report = [];

  const attdefsFor = (ordered, x0, y0, h) =>
    ordered.map((t, row) => ({ tag: t.finalTag, prompt: t.label, x: x0, y: y0 - row * h * 1.5, height: h, invisible: !t.visible }));

  for (const layer of layers) {
    if (!layer.enabled) continue;
    const cadLayer = dxf.addLayer(layer.cadLayer, layer.color);
    const tags = finalTags(layer.fields);
    tags.forEach((t) => !allTags.includes(t.finalTag) && allTags.push(t.finalTag));
    const ordered = [...tags.filter((t) => t.visible), ...tags.filter((t) => !t.visible)];

    const r = symbolSize / 2;
    const hasPoints = layer.geomType === 'point' || layer.geomType === 'mixed';
    const symbolBlock =
      hasPoints || shapeMode === 'tag'
        ? dxf.addBlock(layer.blockName, { primitives: symbolPrimitives(layer.symbol, symbolSize), attdefs: attdefsFor(ordered, r * 1.4, r * 0.3, textHeight) })
        : null;

    const shapeTextHeight = Math.max(textHeight, typicalSize(layer.fc) / 40);
    const shapeBlockBase = String(layer.blockName).replace(/_TAG$/i, '').slice(0, 24);

    const stats = { layer: cadLayer, source: layer.sourceName, block: symbolBlock ?? (shapeMode === 'block' ? `${shapeBlockBase}_n` : null), features: 0, inserts: 0, polylines: 0, skipped: 0, tags: tags.map((t) => t.finalTag) };

    layer.fc.features.forEach((f, idx) => {
      const values = {};
      for (const t of tags) values[t.finalTag] = valueToString(t.name === FID_FIELD ? f.id : f.properties?.[t.name]);

      const shapes = [];
      let anchor = null;
      let placed = false;

      for (const part of geometryParts(f.geometry)) {
        if (part.kind === 'point') {
          const [x, y] = part.coords;
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          dxf.insert(cadLayer, symbolBlock, x, y, values);
          stats.inserts++;
          anchor ??= [x, y];
          placed = true;
        } else if (part.kind === 'line') {
          if (part.coords.length < 2) continue;
          shapes.push({ points: part.coords, closed: false });
          anchor ??= lineMidpoint(part.coords);
        } else if (part.kind === 'polygon') {
          const rings = part.rings.map(stripClosingVertex).filter((rg) => rg.length >= 3);
          if (!rings.length) continue;
          rings.forEach((rg) => shapes.push({ points: rg, closed: true }));
          anchor ??= interiorPoint(rings);
        }
      }

      if (shapes.length) {
        placed = true;
        stats.polylines += shapes.length;
        if (shapeMode === 'block') {
          const [ax, ay] = anchor;
          const block = dxf.addBlock(`${shapeBlockBase}_${idx + 1}`, {
            primitives: shapes.map((sh) => ({ type: 'polyline', closed: sh.closed, points: sh.points.map(([x, y]) => [x - ax, y - ay]) })),
            attdefs: attdefsFor(ordered, 0, 0, shapeTextHeight),
          });
          dxf.insert(cadLayer, block, ax, ay, values);
          stats.inserts++;
        } else {
          shapes.forEach((sh) => dxf.polyline(cadLayer, sh.points, sh.closed));
          if (shapeMode === 'tag' && symbolBlock) {
            dxf.insert(cadLayer, symbolBlock, anchor[0], anchor[1], values);
            stats.inserts++;
          }
        }
      }

      if (placed) {
        stats.features++;
        csvRows.push({ CAD_LAYER: cadLayer, GEOM: layer.geomType, X: anchor?.[0], Y: anchor?.[1], ...values });
      } else {
        stats.skipped++;
      }
    });
    report.push(stats);
  }

  const header = ['CAD_LAYER', 'GEOM', 'X', 'Y', ...allTags];
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : typeof v === 'number' ? v.toFixed(3) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '\uFEFF' + [header.join(','), ...csvRows.map((row) => header.map((h) => esc(row[h])).join(','))].join('\r\n') + '\r\n';

  return { dxf: dxf.toString(), csv, report };
}
