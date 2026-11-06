/**
 * Port pages: `/<category>/<state>/<name>` (for example
 * `/ports/california/port-of-hueneme`) open the app over that port with the
 * port emissions and live vessel layers on. The page is expressed as an
 * ordinary long-form share hash, so restore, URL updates and reloads follow
 * the existing share path.
 *
 * Pure: no DOM.
 */
import { portForPath } from '../emissions/ports.js';
import {
  LAYER_STATE_REGISTRY,
  LAYER_STATE_VERSION,
} from '../data/layerState.js';

const PORT_PAGE_LAYERS = Object.freeze(['port-emissions', 'ais-live-vessels']);

/**
 * The port page a bare `/` opens on this deployment, from
 * `VITE_HOME_PORT_PATH` (for example `/ports/california/port-of-hueneme`).
 * Unset, `/` stays the ordinary globe.
 */
export function homePortPath(env = import.meta.env) {
  const path = env?.VITE_HOME_PORT_PATH;
  return typeof path === 'string' && path.trim() ? path.trim() : null;
}

/** How long the fly-in from the opening globe to a port takes. */
export const PORT_FLY_IN_SECONDS = 7;

/**
 * The share hash (without `#`) for a port page path, or null. A bare `/`
 * resolves to `homePath` when one is given.
 */
export function portRouteHash(pathname, profiles, { homePath = null } = {}) {
  const path =
    homePath && String(pathname ?? '').replace(/\/+$/, '') === ''
      ? homePath
      : pathname;
  const profile = portForPath(path, profiles);
  if (!profile) return null;
  const tokens = PORT_PAGE_LAYERS.map(
    (id) => LAYER_STATE_REGISTRY.find((entry) => entry.id === id)?.token,
  );
  if (tokens.some((token) => !token)) return null;
  const { camera } = profile;
  const params = new URLSearchParams({
    v: String(LAYER_STATE_VERSION),
    lat: camera.lat.toFixed(4),
    lon: camera.lon.toFixed(4),
    alt: String(Math.round(camera.heightM)),
    heading: String(camera.headingDeg ?? 0),
    pitch: String(camera.pitchDeg ?? -60),
    roll: '0',
    l: tokens.join('.'),
  });
  return params.toString();
}
