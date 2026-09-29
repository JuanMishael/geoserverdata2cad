// Tiny WFS client for GeoServer (GetCapabilities + GetFeature as GeoJSON).

function trimBase(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/(wfs|ows)$/i, '');
}

function authHeaders(user, pass) {
  if (!user) return {};
  return { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${user}:${pass ?? ''}`))) };
}

export function getCapabilitiesUrl(baseUrl) {
  return `${trimBase(baseUrl)}/wfs?service=WFS&version=2.0.0&request=GetCapabilities`;
}

export function getFeatureUrl({ baseUrl, typeName, srsName, count, cqlFilter }) {
  const p = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: typeName,
    outputFormat: 'application/json',
  });
  if (srsName) p.set('srsName', srsName);
  if (count) p.set('count', String(count));
  if (cqlFilter?.trim()) p.set('CQL_FILTER', cqlFilter.trim());
  return `${trimBase(baseUrl)}/wfs?${p.toString()}`;
}

async function doFetch(url, auth) {
  let res;
  try {
    res = await fetch(url, { headers: authHeaders(auth?.user, auth?.pass) });
  } catch (e) {
    throw new Error(
      `Could not reach GeoServer (${e.message}). This is usually CORS: use the dev proxy (base URL "/geoserver" + GEOSERVER_TARGET in .env) or enable CORS on GeoServer.`
    );
  }
  if (!res.ok) throw new Error(`GeoServer answered HTTP ${res.status} ${res.statusText}`);
  return res;
}

export async function listFeatureTypes(baseUrl, auth) {
  const res = await doFetch(getCapabilitiesUrl(baseUrl), auth);
  const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
  const types = [...xml.getElementsByTagNameNS('*', 'FeatureType')].map((ft) => {
    const txt = (tag) => ft.getElementsByTagNameNS('*', tag)[0]?.textContent?.trim() ?? '';
    return { name: txt('Name'), title: txt('Title'), defaultCrs: txt('DefaultCRS') || txt('DefaultSRS') };
  });
  if (!types.length) {
    const err = xml.getElementsByTagNameNS('*', 'ExceptionText')[0]?.textContent;
    throw new Error(err ? `GeoServer error: ${err}` : 'No feature types found in GetCapabilities.');
  }
  return types.filter((t) => t.name);
}

export async function getFeatures(opts, auth) {
  const url = getFeatureUrl(opts);
  const res = await doFetch(url, auth);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const m = text.match(/<ows:ExceptionText>([\s\S]*?)<\/ows:ExceptionText>/) || text.match(/<ServiceException[^>]*>([\s\S]*?)<\/ServiceException>/);
    throw new Error(m ? `GeoServer error: ${m[1].trim()}` : 'GeoServer did not return JSON (is outputFormat=application/json enabled?).');
  }
  if (json.type !== 'FeatureCollection') throw new Error('Response is not a GeoJSON FeatureCollection.');
  return { fc: json, url };
}
