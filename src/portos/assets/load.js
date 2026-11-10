/**
 * Load a port's asset registry at run time: the public seed plus the
 * private overlay, when one is present.
 *
 * The overlay holds port staff's real records, so it is not in the
 * repository. Whoever runs the app drops it at public/private/assets/
 * <port>.json (git-ignored), and it is served from /private/assets/. With
 * no file there the public seed is used on its own.
 *
 * Anything placed there is served to every visitor of the site.
 */
import { HUENEME_REGISTRY } from '../hueneme.js';
import { mergeOverlay } from './overlay.js';

export const ASSET_OVERLAY_URL = '/private/assets/port-of-hueneme.json';

export async function loadAssetRegistry({
  seed = HUENEME_REGISTRY,
  url = ASSET_OVERLAY_URL,
  meterIds = [],
  fetchImpl = globalThis.fetch,
} = {}) {
  let overlay = null;
  try {
    const response = await fetchImpl(url, { cache: 'no-cache' });
    const type = response.headers?.get?.('content-type') ?? 'json';
    if (response.ok && type.includes('json')) overlay = await response.json();
  } catch {
    // No overlay served: run on the public seed.
  }
  if (!overlay) return seed;
  const { registry, errors } = mergeOverlay(seed, overlay, { meterIds });
  if (errors.length)
    console.warn('[port assets] overlay ignored:', errors.slice(0, 5));
  return registry;
}
