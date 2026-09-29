# GeoServer → AutoCAD (DXF) export simulator

A small React app that pulls layers from GeoServer (WFS, GeoJSON), lets you map each layer and its asset fields to CAD layers / blocks / attribute tags, and exports a **DXF that plain AutoCAD opens directly**.

- Point assets (poles, transformers, …) → **block inserts with attributes** (one tag per asset field)
- Lines / polygons → **polylines**, plus a small **tag block** at the midpoint / centroid carrying the attributes
- One CAD layer per source layer, with its own colour
- Coordinates in a projected CRS (UTM 51N, PRS92 zones…) in **metres**
- Optional companion CSV of all attributes (keyed by `GIS_FID`)

## Run it

```bash
npm install
cp .env.example .env        # set GEOSERVER_TARGET=http://your-geoserver:8080
npm run dev                 # http://localhost:5173
```

The dev server proxies `/geoserver/*` to `GEOSERVER_TARGET`, so there are no CORS issues. In the app:

1. **Source → GeoServer**, keep base URL `/geoserver` (or `/geoserver/<workspace>`), add user/password if the layers are secured, click **List layers**.
2. Tick the layers, choose the **Target CRS** that matches the installation company's drawings, click **Fetch**.
3. Adjust CAD layer names, block names, symbols and which fields become attributes. Tick **Label** for the field shown next to the symbol (e.g. `POLE_ID`).
4. **Export DXF**.

No GeoServer handy? Use **Source → Sample data**, or run `npm run sample` to write `sample_output/energisuite_sample.dxf` from the command line.

### Reprojection

- **GeoServer (srsName)** – default. GeoServer returns coordinates already in the target CRS.
- **Browser (proj4)** – fetches EPSG:4326 and reprojects client-side. Useful if the server-side CRS setup is odd.

Either way the app warns if coordinates still look like degrees (that would put everything near 0,0 in AutoCAD).

## Checking it in AutoCAD

1. Open the `.dxf` (File → Open, file type DXF). It opens zoomed to the data; if not, type `ZOOM` → `E`.
2. `LAYER` → you should see `EL-POLES`, `EL-TRANSFORMERS`, `EL-MV_LINES`, …
3. Click a pole → **Properties** palette lists all its attributes. Double-click → Enhanced Attribute Editor.
4. `ATTDISP` → `ON` shows the hidden attributes stacked next to each symbol (`NORMAL` to go back).
5. `DATAEXTRACTION` → pick the blocks → all attributes out to a table or Excel.
6. `LIST` on an entity shows its layer and coordinates. Compare one pole against the GeoServer / web map coordinates.
7. Save As → DWG if needed.

## Where the code is

| File | What it does |
| --- | --- |
| `src/lib/dxf.js` | Hand-written **DXF R12** writer (layers, blocks + ATTDEF, INSERT + ATTRIB, POLYLINE). No dependencies, ~250 lines, straightforward to port to C# for the .NET side. |
| `src/lib/cadExport.js` | GeoJSON → CAD mapping: symbols, tag naming, midpoints/centroids, CSV. |
| `src/lib/crs.js` | CRS detection, lat/lon axis-order fix, proj4 reprojection (UTM 50N/51N, PRS92 zones I–V). |
| `src/lib/wfs.js` | GetCapabilities + GetFeature (WFS 2.0, `outputFormat=application/json`). |
| `src/lib/sample.js` | Fake EnergiSuite-like layers around Makati. |

### Why DXF R12?

Plain AutoCAD can't import shapefiles. R12 DXF needs no object handles, so it can be written as plain text, and every AutoCAD version reads it. Non-ASCII text (e.g. `Sto. Niño`) is stored as `\U+00F1`, which AutoCAD decodes. Limits to be aware of: names and tags max 31 chars, attribute values max ~250 chars (longer values go in the CSV only).
