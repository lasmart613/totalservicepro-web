/**
 * Portable twin of GeoMapsUrl.java.
 *
 * Do not parse geo: with URL or URLSearchParams. Those treat '+' as a space
 * and serialize spaces as '+'. Android Uri.encode / encodeURIComponent use
 * '%20', and a raw '+' in the query is a plus.
 */

const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()";

export function queryAfterQ(geoUrl) {
  if (geoUrl == null) return null;
  const marker = geoUrl.indexOf('?q=');
  if (marker < 0) return null;
  const start = marker + 3;
  if (start > geoUrl.length) return null;
  const end = geoUrl.indexOf('&', start);
  const raw = end >= 0 ? geoUrl.slice(start, end) : geoUrl.slice(start);
  return raw ? raw : null;
}

/** Percent-decode only. '+' stays '+', matching decodeURIComponent and Uri.decode. */
export function decodeGeoQuery(raw) {
  if (raw == null) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Spaces as %20. encodeURIComponent already does this; '+' in the value becomes %2B. */
export function encodeMapsQuery(value) {
  return encodeURIComponent(value).replace(/\+/g, '%20');
}

export function mapsSearchUrlFromGeo(geoUrl, decode = decodeGeoQuery, encode = encodeMapsQuery) {
  const raw = queryAfterQ(geoUrl);
  if (raw == null) return null;
  const decoded = decode(raw);
  if (decoded == null || String(decoded).trim() === '') return null;
  let encoded = encode(String(decoded));
  if (encoded == null || encoded === '') return null;
  // Form encoders emit '+' for spaces. A real plus is already '%2B'.
  encoded = String(encoded).replace(/\+/g, '%20');
  return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}

export { UNRESERVED };
