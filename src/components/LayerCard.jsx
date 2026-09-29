import React from 'react';
import { ACI_COLORS, SYMBOLS, FID_FIELD, aciHex } from '../lib/cadExport.js';
import { sanitizeName, sanitizeTag } from '../lib/dxf.js';

const GEOM_LABEL = { point: 'Points', line: 'Lines', polygon: 'Polygons', mixed: 'Mixed', none: 'No geometry' };

export default function LayerCard({ layer, onChange }) {
  const set = (patch) => onChange({ ...layer, ...patch });
  const setField = (i, patch) => set({ fields: layer.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const allOn = layer.fields.every((f) => f.include);
  const isPoint = layer.geomType === 'point';

  return (
    <div className={`card layer-card ${layer.enabled ? '' : 'off'}`}>
      <div className="layer-head">
        <label className="check">
          <input type="checkbox" checked={layer.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span className="swatch" style={{ background: aciHex(layer.color) }} />
          <strong>{layer.sourceName}</strong>
        </label>
        <span className="pill">{GEOM_LABEL[layer.geomType]} · {layer.fc.features.length}</span>
      </div>

      {layer.notes?.length > 0 && (
        <ul className="notes">
          {layer.notes.map((n, i) => (
            <li key={i} className={n.level}>{n.text}</li>
          ))}
        </ul>
      )}

      <div className="grid4">
        <label>
          CAD layer
          <input value={layer.cadLayer} onChange={(e) => set({ cadLayer: e.target.value })} onBlur={(e) => set({ cadLayer: sanitizeName(e.target.value) })} />
        </label>
        <label>
          Color (ACI)
          <select value={layer.color} onChange={(e) => set({ color: Number(e.target.value) })}>
            {ACI_COLORS.map((c) => (
              <option key={c.aci} value={c.aci}>{c.aci} · {c.name}</option>
            ))}
          </select>
        </label>
        <label>
          {isPoint ? 'Block name' : 'Tag block name'}
          <input value={layer.blockName} onChange={(e) => set({ blockName: e.target.value })} onBlur={(e) => set({ blockName: sanitizeName(e.target.value, 'ASSET') })} />
        </label>
        <label>
          Symbol
          <select value={layer.symbol} onChange={(e) => set({ symbol: e.target.value })}>
            {SYMBOLS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <details>
        <summary>
          Attributes <span className="muted">({layer.fields.filter((f) => f.include).length} of {layer.fields.length} exported)</span>
        </summary>
        <table className="fields">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allOn} onChange={(e) => set({ fields: layer.fields.map((f) => ({ ...f, include: e.target.checked })) })} title="Toggle all" />
              </th>
              <th>GeoServer field</th>
              <th>CAD attribute tag</th>
              <th title="Shown as a label next to the symbol. Hidden attributes still show in Properties and DATAEXTRACTION.">Label</th>
            </tr>
          </thead>
          <tbody>
            {layer.fields.map((f, i) => (
              <tr key={f.name} className={f.include ? '' : 'excluded'}>
                <td><input type="checkbox" checked={f.include} onChange={(e) => setField(i, { include: e.target.checked })} /></td>
                <td>{f.name === FID_FIELD ? <em>{f.label}</em> : f.name}</td>
                <td>
                  <input className="tag" value={f.tag} onChange={(e) => setField(i, { tag: e.target.value })} onBlur={(e) => setField(i, { tag: sanitizeTag(e.target.value) })} />
                </td>
                <td><input type="checkbox" checked={f.visible} disabled={!f.include} onChange={(e) => setField(i, { visible: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
