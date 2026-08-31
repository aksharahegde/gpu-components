/**
 * Web Mercator helpers for `GPUDensityMap`.
 *
 * Y is stored **negated** so that north is up under `core`'s continuous viewport transform
 * (`trackToClip` maps smaller domain values to the top of the canvas). Callers still speak
 * lon/lat; only the projected buffers and bounds use this convention.
 */

/** WGS84 spherical radius used by EPSG:3857, in metres. */
export const EARTH_RADIUS_M = 6_378_137;

/** Web Mercator is undefined beyond this latitude (tile / EPSG:3857 limit). */
export const MAX_LAT = 85.051_128_78;

/** Half-world extent in projected metres: `π * R`. */
export const WORLD_HALF_EXTENT = Math.PI * EARTH_RADIUS_M;

export interface MercatorPoint {
  readonly x: number;
  readonly y: number;
}

/** Clamp latitude into the Web Mercator domain. */
export function clampLat(lat: number): number {
  return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
}

/**
 * Lon/lat (degrees) → projected metres, with north-up Y flip described above.
 * Non-finite inputs yield `{ x: NaN, y: NaN }` so ingest can skip them.
 */
export function lonLatToMercator(lon: number, lat: number): MercatorPoint {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { x: Number.NaN, y: Number.NaN };
  }
  const clamped = clampLat(lat);
  const x = EARTH_RADIUS_M * ((lon * Math.PI) / 180);
  const mercY = EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
  return { x, y: -mercY };
}

/** Inverse of `lonLatToMercator` — for a11y labels and graticule tick text. */
export function mercatorToLonLat(x: number, y: number): { readonly lon: number; readonly lat: number } {
  const mercY = -y;
  const lon = (x / EARTH_RADIUS_M) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(mercY / EARTH_RADIUS_M)) - Math.PI / 2) * (180 / Math.PI);
  return { lon, lat };
}
