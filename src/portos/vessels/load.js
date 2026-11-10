/**
 * Load the port's ship inventory at run time.
 *
 * Two files, so public registry facts and the port's own call history can
 * be kept apart:
 *  - particulars: public registry data per ship (IMO, size, age). Served
 *    from /data/vessels/<port>.json when it is published with the app, or
 *    from /private/vessels/<port>.json when the port keeps it private.
 *  - call history: how often each ship called and at which berths, from the
 *    port's own schedule. Always private: public/private/vessels/
 *    <port>-calls.json (git-ignored), served from /private/vessels/.
 *
 * Anything under public/private/ is served to every visitor of the site,
 * so it is only private to the repository, not to the web.
 * With no files the inventory is empty.
 */
import { mergeCallHistory, normalizeInventory } from './registry.js';

export const VESSEL_URLS = Object.freeze({
  particulars: [
    '/private/vessels/port-of-hueneme.json',
    '/data/vessels/port-of-hueneme.json',
  ],
  calls: '/private/vessels/port-of-hueneme-calls.json',
});

async function fetchJson(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { cache: 'no-cache' });
    const type = response.headers?.get?.('content-type') ?? 'json';
    if (!response.ok || !type.includes('json')) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function loadVesselInventory({
  urls = VESSEL_URLS,
  fetchImpl = globalThis.fetch,
} = {}) {
  let raw = null;
  for (const url of urls.particulars) {
    raw = await fetchJson(url, fetchImpl);
    if (raw) break;
  }
  const inventory = normalizeInventory(raw ?? {});
  const calls = urls.calls ? await fetchJson(urls.calls, fetchImpl) : null;
  return mergeCallHistory(inventory, calls);
}
