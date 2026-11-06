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

/** The share hash (without `#`) for a port page path, or null. */
export function portRouteHash(pathname, profiles) {
  const profile = portForPath(pathname, profiles);
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
