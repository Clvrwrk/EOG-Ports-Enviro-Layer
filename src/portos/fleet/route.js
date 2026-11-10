/**
 * Routes and elevation for the EV planner, from the app's own keyless
 * endpoints: `/api/route` (OpenStreetMap routing via FOSSGIS OSRM, car
 * profile) and `/api/terrain/heights` (Re:Earth terrain, 64 points a call).
 * FleetVolt used Google Routes and Open-Elevation; these need no key.
 *
 * Car routing stands in for truck routing: it can pick roads closed to
 * trucks and is quicker than a loaded truck, which the physics caps anyway.
 *
 * `fetchImpl` is injectable so tests run without a network.
 */
import { cumulativeDistances, interpolatePointAtDist } from './physics.js';

/** Max points per terrain call (the server's upstream chunk). */
export const TERRAIN_CHUNK = 64;
/** Elevation sample spacing bounds (m) and the most samples per route. */
export const MIN_SAMPLE_M = 150;
export const MAX_SAMPLES = 1200;

/** Distances to sample elevation at along a route of `lengthM`. */
export function sampleDistances(lengthM) {
  const step = Math.max(MIN_SAMPLE_M, lengthM / MAX_SAMPLES);
  const out = [];
  for (let d = 0; d < lengthM; d += step) out.push(d);
  out.push(lengthM);
  return out;
}

/**
 * Driving route between two { lat, lon } points:
 * { coordinates: [[lon, lat], ...], distanceM, durationS }.
 */
export async function fetchRoute(
  origin,
  dest,
  { fetchImpl = globalThis.fetch, signal } = {},
) {
  const coords = `${origin.lon.toFixed(6)},${origin.lat.toFixed(6)};${dest.lon.toFixed(6)},${dest.lat.toFixed(6)}`;
  const response = await fetchImpl(
    `/api/route?profile=car&coords=${encodeURIComponent(coords)}`,
    { signal, headers: { Accept: 'application/json' } },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok || !Array.isArray(payload.geometry))
    throw new Error(
      payload?.error
        ? `Routing failed: ${payload.error}`
        : `Routing unavailable (HTTP ${response.status})`,
    );
  return {
    coordinates: payload.geometry,
    distanceM: payload.distanceM,
    durationS: payload.durationS,
  };
}

/**
 * Elevation profile [{ dist_m, elev_m }] along a [lon, lat] route. Uses the
 * orthometric `elevation` when the terrain service gives one, else the
 * ellipsoidal height (the geoid offset barely changes over a route, so
 * grades are unaffected). Points the service cannot answer are dropped.
 */
export async function fetchElevationProfile(
  coordinates,
  { fetchImpl = globalThis.fetch, signal } = {},
) {
  const cum = cumulativeDistances(coordinates);
  const length = cum.at(-1) ?? 0;
  const dists = sampleDistances(length);
  const points = dists.map((d) => interpolatePointAtDist(coordinates, d, cum));
  const profile = [];
  for (let i = 0; i < points.length; i += TERRAIN_CHUNK) {
    const chunk = points.slice(i, i + TERRAIN_CHUNK);
    const query = chunk
      .map(([lon, lat]) => `${lon.toFixed(5)},${lat.toFixed(5)}`)
      .join(';');
    const response = await fetchImpl(
      `/api/terrain/heights?points=${encodeURIComponent(query)}`,
      { signal, headers: { Accept: 'application/json' } },
    );
    const body = await response.json().catch(() => null);
    const results = body?.results ?? body?.partial ?? [];
    chunk.forEach((_, k) => {
      const r = results[k];
      const elev = Number.isFinite(r?.elevation) ? r.elevation : r?.ellipsoid;
      if (Number.isFinite(elev))
        profile.push({ dist_m: dists[i + k], elev_m: elev });
    });
  }
  if (profile.length < 2)
    throw new Error('Terrain heights unavailable for this route');
  return profile;
}

/** Reverse a route (the drive back to port follows the same roads). */
export function reverseRoute(route, profile) {
  const length = profile.at(-1)?.dist_m ?? route.distanceM;
  return {
    route: { ...route, coordinates: [...route.coordinates].reverse() },
    profile: profile
      .map((p) => ({ dist_m: length - p.dist_m, elev_m: p.elev_m }))
      .reverse(),
  };
}
