/**
 * Fetch a drop site's route and elevation (cached per site) and plan the
 * round trip for a truck model. Shared by the twin's EV Planning section
 * and the /ev-planning page.
 */
import { fleetModel } from './catalog.js';
import { DROP_SITES, POH_ORIGIN, fleetDay, planRoundTrip } from './planner.js';
import { fetchElevationProfile, fetchRoute, reverseRoute } from './route.js';

const cache = new Map();

/** Route and elevation out to `site` and back, fetched once per site. */
export function routeToSite(site, { fetchImpl = globalThis.fetch } = {}) {
  if (!cache.has(site.id)) {
    const pending = (async () => {
      const out = await fetchRoute(POH_ORIGIN, site, { fetchImpl });
      const outProfile = await fetchElevationProfile(out.coordinates, {
        fetchImpl,
      });
      const back = reverseRoute(out, outProfile);
      return { out, outProfile, back: back.route, backProfile: back.profile };
    })();
    cache.set(site.id, pending);
    pending.catch(() => cache.delete(site.id));
  }
  return cache.get(site.id);
}

/**
 * Plan a round trip and the fleet day for it.
 * @param {{ siteId: string, modelId: string, trip?: object, fleet?: object }} request
 */
export async function runTrip(
  { siteId, modelId, trip = {}, fleet = {} },
  options = {},
) {
  const site = DROP_SITES.find((s) => s.id === siteId);
  const model = fleetModel(modelId);
  if (!site) throw new Error(`Unknown drop site ${siteId}`);
  if (!model?.physicsId) throw new Error(`Pick a battery-electric truck`);
  const routes = await routeToSite(site, options);
  const plan = planRoundTrip({ model, ...routes, options: trip });
  return { site, model, routes, trip: plan, fleet: fleetDay(plan, fleet) };
}
