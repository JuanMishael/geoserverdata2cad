import React, { useEffect, useMemo, useRef, useState } from 'react';
import { aciHex, geometryParts } from '../lib/cadExport.js';

const DRAW_ORDER = { polygon: 0, mixed: 1, line: 2, point: 3 };

// Plain SVG preview in projected coordinates (metres), i.e. what AutoCAD will see.
export default function MapPreview({ layers }) {
  const visible = layers.filter((l) => l.enabled);
  // Only re-fit the view when the set of visible layers changes, not on every mapping edit.
  const extentKey = visible.map((l) => l.id).join('|');

  const extent = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = ([x, y]) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    };
    for (const l of visible)
      for (const f of l.fc.features)
        for (const p of geometryParts(f.geometry)) {
          if (p.kind === 'point') add(p.coords);
          else if (p.kind === 'line') p.coords.forEach(add);
          else p.rings.forEach((r) => r.forEach(add));
        }
    if (!Number.isFinite(minX)) return null;
    const pad = Math.max(maxX - minX, maxY - minY, 10) * 0.05;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad || 20, h: maxY - minY + 2 * pad || 20 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extentKey]);

  const [view, setView] = useState(extent);
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => setView(extent), [extent]);

  // Wheel zoom needs a non-passive listener.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setView((v) => {
        if (!v) return v;
        const k = e.deltaY > 0 ? 1.2 : 1 / 1.2;
        const s = Math.max(v.w / rect.width, v.h / rect.height);
        const ox = v.x + (v.w - rect.width * s) / 2;
        const oy = v.y + (v.h - rect.height * s) / 2;
        const mx = ox + (e.clientX - rect.left) * s;
        const my = oy + (rect.height - (e.clientY - rect.top)) * s;
        return { x: mx - (mx - v.x) * k, y: my - (my - v.y) * k, w: v.w * k, h: v.h * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  if (!extent || !view) {
    return <div className="map empty">Load sample data or fetch layers from GeoServer to see a preview.</div>;
  }

  const onDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, v: view };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const s = Math.max(view.w / rect.width, view.h / rect.height);
    const d = drag.current;
    setView({ ...d.v, x: d.v.x - (e.clientX - d.x) * s, y: d.v.y + (e.clientY - d.y) * s });
  };
  const onUp = () => (drag.current = null);

  // SVG y grows downward, so flip: screen y = -(world y)
  const vb = `${view.x} ${-(view.y + view.h)} ${view.w} ${view.h}`;
  const r = view.w / 220;
  const P = ([x, y]) => `${x},${-y}`;

  return (
    <div className="map">
      <svg ref={svgRef} viewBox={vb} preserveAspectRatio="xMidYMid meet" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
        {/* draw polygons first, points last, so small assets stay on top and hoverable */}
        {[...visible].sort((a, b) => (DRAW_ORDER[a.geomType] ?? 1) - (DRAW_ORDER[b.geomType] ?? 1)).map((l) => {
          const color = aciHex(l.color);
          return (
            <g key={l.id}>
              {l.fc.features.map((f, i) => {
                const hv = () => setHover({ layer: l.cadLayer, id: f.id, props: f.properties });
                const parts = [...geometryParts(f.geometry)];
                return parts.map((p, j) => {
                  const key = `${i}-${j}`;
                  if (p.kind === 'point')
                    return <circle key={key} cx={p.coords[0]} cy={-p.coords[1]} r={r} fill={color} stroke="var(--bg)" strokeWidth={r * 0.3} onPointerEnter={hv} />;
                  if (p.kind === 'line')
                    return <polyline key={key} points={p.coords.map(P).join(' ')} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" onPointerEnter={hv} />;
                  return (
                    <path
                      key={key}
                      d={p.rings.map((ring) => 'M' + ring.map(P).join('L') + 'Z').join(' ')}
                      fill={color}
                      fillOpacity="0.08"
                      stroke={color}
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                      onPointerEnter={hv}
                    />
                  );
                });
              })}
            </g>
          );
        })}
      </svg>
      <div className="map-tools">
        <button className="ghost small" onClick={() => setView(extent)}>Zoom extents</button>
      </div>
      {hover && (
        <div className="hover-card">
          <div className="hover-title">
            <span>{hover.layer}</span>
            <code>{hover.id}</code>
          </div>
          <table>
            <tbody>
              {Object.entries(hover.props || {}).slice(0, 12).map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v === null || v === undefined ? '—' : String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
