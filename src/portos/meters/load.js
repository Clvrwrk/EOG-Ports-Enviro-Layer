/**
 * Load the port's meter registry at run time.
 *
 * The real registry holds account numbers and bills, so it is not in the
 * repository. Whoever runs the app drops it at public/private/meters/
 * <port>.json (git-ignored), and it is served from /private/meters/. With no
 * file there the sample registry is used and labelled as sample data.
 *
 * Anything placed there is served to every visitor of the site.
 */
import { SAMPLE_REGISTRY, normalizeRegistry } from './registry.js';

export const METER_REGISTRY_URL = '/private/meters/port-of-hueneme.json';

export async function loadMeterRegistry({
  url = METER_REGISTRY_URL,
  fetchImpl = globalThis.fetch,
  fallback = SAMPLE_REGISTRY,
} = {}) {
  try {
    const response = await fetchImpl(url, { cache: 'no-cache' });
    const type = response.headers?.get?.('content-type') ?? 'json';
    if (!response.ok || !type.includes('json')) return fallback;
    return normalizeRegistry(await response.json());
  } catch (error) {
    console.warn('[port meters] using the sample registry:', error.message);
    return fallback;
  }
}
