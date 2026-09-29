// Minimal AutoCAD R12 (AC1009) ASCII DXF writer.
//
// Why R12: it needs no entity handles or object dictionaries, so it is easy to
// write by hand (and easy to port to C# later), and every AutoCAD version
// opens it directly. It supports everything we need: layers, blocks with
// attribute definitions (ATTDEF), inserts with attribute values (ATTRIB),
// polylines and text. After opening, users can simply "Save As" DWG.

const NL = '\r\n';

function num(n) {
  if (!Number.isFinite(n) || Math.abs(n) < 1e-9) return '0';
  return n.toFixed(6).replace(/\.?0+$/, '');
}

/** Layer / block names: uppercase, R12-safe characters, max 31 chars. */
export function sanitizeName(name, fallback = 'LAYER') {
  let t = String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9_$-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!t) t = fallback;
  return t.slice(0, 31);
}

/** Attribute tags: no spaces, uppercase, must not start with a digit. */
export function sanitizeTag(name) {
  let t = sanitizeName(name, 'FIELD').replace(/\$/g, '_');
  if (/^[0-9-]/.test(t)) t = 'F_' + t;
  return t.slice(0, 31);
}

/**
 * Text values: single line, max 250 chars, non-ASCII encoded as \U+XXXX
 * (the R12 way of storing Unicode, e.g. "ñ" -> \U+00F1).
 */
export function dxfText(value, max = 250) {
  let s = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp < 32) continue;
    if (ch === '^') out += '^ '; // caret is an escape char in DXF strings
    else if (cp > 0xffff) out += '?';
    else if (cp > 126) out += '\\U+' + cp.toString(16).toUpperCase().padStart(4, '0');
    else out += ch;
    if (out.length >= max) break;
  }
  return out;
}

function clampColor(c) {
  const n = Math.round(Number(c));
  return n >= 1 && n <= 255 ? n : 7;
}

export class DxfR12 {
  constructor() {
    this.layers = new Map([['0', 7]]);
    this.blocks = new Map();
    this.entities = [];
    this.minX = Infinity;
    this.minY = Infinity;
    this.maxX = -Infinity;
    this.maxY = -Infinity;
  }

  _ext(x, y) {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }

  addLayer(name, color = 7) {
    const n = sanitizeName(name);
    if (!this.layers.has(n)) this.layers.set(n, clampColor(color));
    return n;
  }

  /**
   * primitives: [{type:'circle',x,y,r} | {type:'line',x1,y1,x2,y2} | {type:'polyline',points:[[x,y]],closed}]
   * attdefs:    [{tag, prompt, defaultValue, x, y, height, invisible}]
   */
  addBlock(name, { primitives = [], attdefs = [] } = {}) {
    let n = sanitizeName(name, 'BLOCK');
    let i = 2;
    const base = n.slice(0, 28);
    while (this.blocks.has(n)) n = `${base}_${i++}`;
    this.blocks.set(n, { primitives, attdefs });
    return n;
  }

  /** Insert a block; `values` maps attribute tag -> value. */
  insert(layer, block, x, y, values = {}) {
    const def = this.blocks.get(block);
    if (!def) throw new Error(`Unknown block ${block}`);
    this._ext(x, y);
    this.entities.push({ kind: 'insert', layer, block, x, y, def, values });
  }

  polyline(layer, points, closed = false) {
    const pts = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 2) return false;
    pts.forEach((p) => this._ext(p[0], p[1]));
    this.entities.push({ kind: 'polyline', layer, points: pts, closed });
    return true;
  }

  text(layer, x, y, height, value) {
    this._ext(x, y);
    this.entities.push({ kind: 'text', layer, x, y, height, value });
  }

  toString() {
    const out = [];
    const g = (code, value) => {
      out.push(String(code).padStart(3, ' '));
      out.push(typeof value === 'number' ? num(value) : String(value));
    };
    const gi = (code, value) => {
      // integer group codes
      out.push(String(code).padStart(3, ' '));
      out.push(String(Math.round(value)).padStart(6, ' '));
    };

    const hasExt = Number.isFinite(this.minX);
    const minX = hasExt ? this.minX : 0;
    const minY = hasExt ? this.minY : 0;
    const maxX = hasExt ? this.maxX : 100;
    const maxY = hasExt ? this.maxY : 100;
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const aspect = 1.6;
    const viewHeight = Math.max(h, w / aspect) * 1.1;

    // ---- HEADER
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252');
    g(9, '$INSBASE'); g(10, 0); g(20, 0); g(30, 0);
    g(9, '$EXTMIN'); g(10, minX); g(20, minY); g(30, 0);
    g(9, '$EXTMAX'); g(10, maxX); g(20, maxY); g(30, 0);
    g(9, '$LIMMIN'); g(10, minX); g(20, minY);
    g(9, '$LIMMAX'); g(10, maxX); g(20, maxY);
    g(9, '$LUNITS'); gi(70, 2);
    g(9, '$LUPREC'); gi(70, 3);
    g(9, '$ATTMODE'); gi(70, 1);
    g(0, 'ENDSEC');

    // ---- TABLES
    g(0, 'SECTION'); g(2, 'TABLES');

    // VPORT: open the drawing already zoomed to the data
    g(0, 'TABLE'); g(2, 'VPORT'); gi(70, 1);
    g(0, 'VPORT'); g(2, '*ACTIVE'); gi(70, 0);
    g(10, 0); g(20, 0); g(11, 1); g(21, 1);
    g(12, (minX + maxX) / 2); g(22, (minY + maxY) / 2);
    g(13, 0); g(23, 0); g(14, 1); g(24, 1); g(15, 10); g(25, 10);
    g(16, 0); g(26, 0); g(36, 1);
    g(17, 0); g(27, 0); g(37, 0);
    g(40, viewHeight); g(41, aspect); g(42, 50); g(43, 0); g(44, 0);
    g(50, 0); g(51, 0);
    gi(71, 0); gi(72, 100); gi(73, 1); gi(74, 3); gi(75, 0); gi(76, 0); gi(77, 0); gi(78, 0);
    g(0, 'ENDTAB');

    g(0, 'TABLE'); g(2, 'LTYPE'); gi(70, 1);
    g(0, 'LTYPE'); g(2, 'CONTINUOUS'); gi(70, 0); g(3, 'Solid line'); gi(72, 65); gi(73, 0); g(40, 0);
    g(0, 'ENDTAB');

    g(0, 'TABLE'); g(2, 'LAYER'); gi(70, this.layers.size);
    for (const [name, color] of this.layers) {
      g(0, 'LAYER'); g(2, name); gi(70, 0); gi(62, color); g(6, 'CONTINUOUS');
    }
    g(0, 'ENDTAB');

    g(0, 'TABLE'); g(2, 'STYLE'); gi(70, 1);
    g(0, 'STYLE'); g(2, 'STANDARD'); gi(70, 0); g(40, 0); g(41, 1); g(50, 0); gi(71, 0); g(42, 1); g(3, 'txt'); g(4, '');
    g(0, 'ENDTAB');

    g(0, 'TABLE'); g(2, 'APPID'); gi(70, 1);
    g(0, 'APPID'); g(2, 'ACAD'); gi(70, 0);
    g(0, 'ENDTAB');

    g(0, 'ENDSEC');

    // ---- BLOCKS
    g(0, 'SECTION'); g(2, 'BLOCKS');
    for (const [name, def] of this.blocks) {
      g(0, 'BLOCK'); g(8, '0'); g(2, name); gi(70, def.attdefs.length ? 2 : 0);
      g(10, 0); g(20, 0); g(30, 0); g(3, name);
      // Block geometry lives on layer 0 so it takes the colour of the layer it is inserted on.
      for (const p of def.primitives) {
        if (p.type === 'circle') {
          g(0, 'CIRCLE'); g(8, '0'); g(10, p.x); g(20, p.y); g(30, 0); g(40, p.r);
        } else if (p.type === 'line') {
          g(0, 'LINE'); g(8, '0'); g(10, p.x1); g(20, p.y1); g(30, 0); g(11, p.x2); g(21, p.y2); g(31, 0);
        } else if (p.type === 'polyline') {
          g(0, 'POLYLINE'); g(8, '0'); gi(66, 1); g(10, 0); g(20, 0); g(30, 0); gi(70, p.closed ? 1 : 0);
          for (const [x, y] of p.points) { g(0, 'VERTEX'); g(8, '0'); g(10, x); g(20, y); g(30, 0); }
          g(0, 'SEQEND'); g(8, '0');
        }
      }
      for (const a of def.attdefs) {
        g(0, 'ATTDEF'); g(8, '0');
        g(10, a.x); g(20, a.y); g(30, 0); g(40, a.height);
        g(1, dxfText(a.defaultValue ?? ''));
        g(3, dxfText(a.prompt ?? a.tag));
        g(2, a.tag);
        gi(70, a.invisible ? 1 : 0);
      }
      g(0, 'ENDBLK'); g(8, '0');
    }
    g(0, 'ENDSEC');

    // ---- ENTITIES
    g(0, 'SECTION'); g(2, 'ENTITIES');
    for (const e of this.entities) {
      if (e.kind === 'insert') {
        const hasAtt = e.def.attdefs.length > 0;
        g(0, 'INSERT'); g(8, e.layer);
        if (hasAtt) gi(66, 1);
        g(2, e.block); g(10, e.x); g(20, e.y); g(30, 0);
        if (hasAtt) {
          for (const a of e.def.attdefs) {
            g(0, 'ATTRIB'); g(8, e.layer);
            g(10, e.x + a.x); g(20, e.y + a.y); g(30, 0); g(40, a.height);
            g(1, dxfText(e.values[a.tag] ?? ''));
            g(2, a.tag);
            gi(70, a.invisible ? 1 : 0);
          }
          g(0, 'SEQEND'); g(8, e.layer);
        }
      } else if (e.kind === 'polyline') {
        g(0, 'POLYLINE'); g(8, e.layer); gi(66, 1); g(10, 0); g(20, 0); g(30, 0); gi(70, e.closed ? 1 : 0);
        for (const [x, y] of e.points) { g(0, 'VERTEX'); g(8, e.layer); g(10, x); g(20, y); g(30, 0); }
        g(0, 'SEQEND'); g(8, e.layer);
      } else if (e.kind === 'text') {
        g(0, 'TEXT'); g(8, e.layer); g(10, e.x); g(20, e.y); g(30, 0); g(40, e.height); g(1, dxfText(e.value));
      }
    }
    g(0, 'ENDSEC');
    g(0, 'EOF');
    return out.join(NL) + NL;
  }
}
