// Builds sample_output/energisuite_sample.dxf (+ .csv) from the built-in sample data,
// using exactly the same code the web app uses. Handy for testing AutoCAD without a GeoServer.
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeSampleData } from '../src/lib/sample.js';
import { prepareFeatureCollection } from '../src/lib/crs.js';
import { makeLayerMapping, buildCadExport } from '../src/lib/cadExport.js';

const target = process.argv[2] || 'EPSG:32651';
const layers = Object.entries(makeSampleData()).map(([name, raw], i) => {
  const { fc, notes } = prepareFeatureCollection(raw, target);
  notes.forEach((n) => console.log(`[${name}] ${n.level}: ${n.text}`));
  return makeLayerMapping(name, fc, notes, i);
});
const { dxf, csv, report } = buildCadExport(layers, { symbolSize: 1.5, textHeight: 0.6, lineTags: true });
mkdirSync('sample_output', { recursive: true });
writeFileSync('sample_output/energisuite_sample.dxf', dxf, 'latin1');
writeFileSync('sample_output/energisuite_sample.csv', csv, 'utf8');
console.table(report.map(({ tags, ...r }) => ({ ...r, attributes: tags.length })));
