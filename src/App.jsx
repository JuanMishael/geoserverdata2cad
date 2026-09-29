import React, { useMemo, useState } from 'react';
import MapPreview from './components/MapPreview.jsx';
import LayerCard from './components/LayerCard.jsx';
import { makeSampleData } from './lib/sample.js';
import { CRS_OPTIONS, prepareFeatureCollection } from './lib/crs.js';
import { makeLayerMapping, buildCadExport } from './lib/cadExport.js';
import { listFeatureTypes, getFeatures, getFeatureUrl } from './lib/wfs.js';

function download(name, content, type, encoding) {
  // R12 DXF is ANSI text; unicode is already escaped as \U+XXXX so plain ASCII bytes are safe.
  const blob = encoding === 'latin1'
    ? new Blob([Uint8Array.from(content, (c) => c.charCodeAt(0) & 0xff)], { type })
    : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function App() {
  const [source, setSource] = useState('sample');
  const [targetCrs, setTargetCrs] = useState('EPSG:32651');

  // GeoServer connection
  const [baseUrl, setBaseUrl] = useState('/geoserver');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [types, setTypes] = useState([]);
  const [selected, setSelected] = useState([]);
  const [count, setCount] = useState(2000);
  const [cql, setCql] = useState('');
  const [reprojectOn, setReprojectOn] = useState('geoserver');

  // Output
  const [settings, setSettings] = useState({ symbolSize: 1.5, textHeight: 0.6, shapeMode: 'block', filename: 'energisuite_export', csv: false });
  const [layers, setLayers] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [lastExport, setLastExport] = useState(null);

  const auth = { user, pass };

  const loadSample = () => {
    setError('');
    const data = makeSampleData();
    setLayers(
      Object.entries(data).map(([name, raw], i) => {
        const { fc, notes } = prepareFeatureCollection(raw, targetCrs);
        return makeLayerMapping(name, fc, notes, i);
      })
    );
    setLastExport(null);
  };

  const loadTypes = async () => {
    setError('');
    setBusy('Reading GetCapabilities…');
    try {
      const t = await listFeatureTypes(baseUrl, auth);
      setTypes(t);
      setSelected([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const fetchLayers = async () => {
    setError('');
    const out = [];
    try {
      for (const [i, typeName] of selected.entries()) {
        setBusy(`Fetching ${typeName} (${i + 1}/${selected.length})…`);
        const { fc: raw, url } = await getFeatures(
          { baseUrl, typeName, srsName: reprojectOn === 'geoserver' ? targetCrs : 'EPSG:4326', count, cqlFilter: cql },
          auth
        );
        const { fc, notes } = prepareFeatureCollection(raw, targetCrs);
        const total = raw.numberMatched ?? raw.totalFeatures;
        if (typeof total === 'number' && total > fc.features.length)
          notes.push({ level: 'warn', text: `Only ${fc.features.length} of ${total} features fetched. Raise the feature limit to export everything.` });
        notes.push({ level: 'info', text: `GET ${url}` });
        out.push(makeLayerMapping(typeName, fc, notes, i));
      }
      setLayers(out);
      setLastExport(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const exportCad = () => {
    const result = buildCadExport(layers, settings);
    const base = settings.filename.trim() || 'export';
    download(`${base}.dxf`, result.dxf, 'application/dxf', 'latin1');
    if (settings.csv) setTimeout(() => download(`${base}_attributes.csv`, result.csv, 'text/csv;charset=utf-8'), 300);
    setLastExport({ report: result.report, size: result.dxf.length });
  };

  const exampleUrl = useMemo(
    () =>
      getFeatureUrl({
        baseUrl,
        typeName: selected[0] || types[0]?.name || 'workspace:layer',
        srsName: reprojectOn === 'geoserver' ? targetCrs : 'EPSG:4326',
        count,
        cqlFilter: cql,
      }),
    [baseUrl, selected, types, reprojectOn, targetCrs, count, cql]
  );

  const enabledCount = layers.filter((l) => l.enabled).length;
  const setS = (patch) => setSettings((s) => ({ ...s, ...patch }));

  return (
    <div className="app">
      <header>
        <div>
          <h1>GeoServer → AutoCAD</h1>
          <p className="muted">Pull WFS layers, map asset fields to block attributes, and export a DXF that plain AutoCAD opens directly.</p>
        </div>
      </header>

      <main>
        <aside>
          <section className="card">
            <h2>1 · Source</h2>
            <div className="seg">
              <button className={source === 'sample' ? 'on' : ''} onClick={() => setSource('sample')}>Sample data</button>
              <button className={source === 'geoserver' ? 'on' : ''} onClick={() => setSource('geoserver')}>GeoServer</button>
            </div>

            <label>
              Target CRS (drawing coordinates)
              <select
                value={targetCrs}
                onChange={(e) => {
                  setTargetCrs(e.target.value);
                  // loaded layers were projected for the old CRS; make the user reload them
                  if (layers.length) { setLayers([]); setLastExport(null); setError('CRS changed. Load the layers again.'); }
                }}
              >
                {CRS_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} · {c.label}</option>
                ))}
              </select>
            </label>

            {source === 'sample' ? (
              <>
                <p className="muted small">Fake poles, transformers, MV lines and service areas around Makati, in EPSG:4326 like a typical GeoServer store.</p>
                <button className="primary" onClick={loadSample}>Load sample layers</button>
              </>
            ) : (
              <>
                <label>
                  GeoServer base URL
                  <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="/geoserver  or  /geoserver/workspace" />
                </label>
                <p className="muted small">
                  Keep <code>/geoserver</code> to go through the dev proxy (set <code>GEOSERVER_TARGET</code> in <code>.env</code>). Add <code>/workspace</code> to limit to one workspace.
                </p>
                <div className="grid2">
                  <label>User <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" placeholder="optional" /></label>
                  <label>Password <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" /></label>
                </div>
                <button onClick={loadTypes} disabled={!!busy}>List layers</button>

                {types.length > 0 && (
                  <div className="type-list">
                    {types.map((t) => (
                      <label key={t.name} className="check">
                        <input
                          type="checkbox"
                          checked={selected.includes(t.name)}
                          onChange={(e) => setSelected((s) => (e.target.checked ? [...s, t.name] : s.filter((n) => n !== t.name)))}
                        />
                        <span>{t.name}</span>
                        {t.title && t.title !== t.name.split(':').pop() && <span className="muted small"> {t.title}</span>}
                      </label>
                    ))}
                  </div>
                )}

                <div className="grid2">
                  <label>Feature limit <input type="number" min="1" value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
                  <label>
                    Reproject on
                    <select value={reprojectOn} onChange={(e) => setReprojectOn(e.target.value)}>
                      <option value="geoserver">GeoServer (srsName)</option>
                      <option value="browser">Browser (proj4)</option>
                    </select>
                  </label>
                </div>
                <label>
                  CQL filter <span className="muted">(optional)</span>
                  <input value={cql} onChange={(e) => setCql(e.target.value)} placeholder="feeder = 'MKT-F01'" />
                </label>
                <details className="url">
                  <summary>Request URL</summary>
                  <code>{exampleUrl}</code>
                </details>
                <button className="primary" onClick={fetchLayers} disabled={!selected.length || !!busy}>
                  Fetch {selected.length || ''} layer{selected.length === 1 ? '' : 's'}
                </button>
              </>
            )}
            {busy && <p className="busy">{busy}</p>}
            {error && <p className="error">{error}</p>}
          </section>

          <section className="card">
            <h2>3 · Export</h2>
            <div className="grid2">
              <label>Symbol size (m) <input type="number" step="0.1" min="0.1" value={settings.symbolSize} onChange={(e) => setS({ symbolSize: Number(e.target.value) })} /></label>
              <label>Text height (m) <input type="number" step="0.1" min="0.05" value={settings.textHeight} onChange={(e) => setS({ textHeight: Number(e.target.value) })} /></label>
            </div>
            <label>
              Lines &amp; polygons
              <select value={settings.shapeMode} onChange={(e) => setS({ shapeMode: e.target.value })}>
                <option value="block">Attributes on the shape itself (click outline → data)</option>
                <option value="tag">Plain polyline + tag point inside it</option>
                <option value="none">Plain polylines, no attributes</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.csv} onChange={(e) => setS({ csv: e.target.checked })} />
              Also download a CSV copy of the attributes (optional)
            </label>
            <label>File name <input value={settings.filename} onChange={(e) => setS({ filename: e.target.value })} /></label>
            <button className="primary big" disabled={!enabledCount} onClick={exportCad}>
              Export DXF{settings.csv ? ' + CSV' : ''}
            </button>

            {lastExport && (
              <div className="report">
                <p className="small">DXF R12 · {(lastExport.size / 1024).toFixed(0)} KB · {targetCrs}</p>
                <table>
                  <thead>
                    <tr><th>Layer</th><th>Block</th><th>Features</th><th>Attrs</th></tr>
                  </thead>
                  <tbody>
                    {lastExport.report.map((r) => (
                      <tr key={r.layer}>
                        <td>{r.layer}</td>
                        <td>{r.block ?? '—'}</td>
                        <td>{r.features}{r.skipped ? ` (${r.skipped} skipped)` : ''}</td>
                        <td>{r.tags.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted small">In AutoCAD: open the DXF, click an asset → Properties shows its attributes. <code>ATTDISP</code> → On shows hidden ones; <code>DATAEXTRACTION</code> pulls them to a table.</p>
              </div>
            )}
          </section>
        </aside>

        <div className="work">
          <MapPreview layers={layers} />
          <section>
            <h2>2 · Map layers to CAD {layers.length > 0 && <span className="muted">({enabledCount} of {layers.length} enabled)</span>}</h2>
            {layers.length === 0 && <p className="muted">No layers loaded yet.</p>}
            {layers.map((l) => (
              <LayerCard key={l.id} layer={l} onChange={(nl) => setLayers((ls) => ls.map((x) => (x.id === nl.id ? nl : x)))} />
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}
