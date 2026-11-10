import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ASSET_CLASSES, validateRegistry } from '../assetClasses.js';
import { HUENEME_REGISTRY } from '../hueneme.js';
import {
  DEFAULT_BEV_DRAYAGE_ID,
  DEFAULT_DIESEL_DRAYAGE_ID,
  DEFAULT_LINE_HAUL_ID,
  FLEET_CATEGORIES,
  FLEET_MODELS,
  buildFleetCatalog,
  compareAnnual,
  emissionsPerTonMile,
  emissionsPerUnit,
  fleetModel,
  modelsForAssetClass,
  ogvModels,
  physicsTruckOf,
} from './catalog.js';
import { FLEETVOLT_TRUCKS } from './fleetvoltTrucks.js';
import {
  US_MILE_M,
  buildSegments,
  integrateChargeCurve,
  planGreedyStops,
  simulateTrip,
  truckParams,
} from './physics.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

// FleetVolt's parity truck (data/trucks/ecascadia_438.json).
const ECASCADIA = FLEETVOLT_TRUCKS.find(
  (t) => t.id === 'ecascadia_438',
).physics;

/** FleetVolt's straight-line corridor geometry (orchestrator.syntheticCoordinates). */
function straightLine(a, b, n = 32) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [a[1] + t * (b[1] - a[1]), a[0] + t * (b[0] - a[0])];
  });
}

function assertParity(name, ours, python) {
  const diff =
    Math.abs(ours.kpis.total_kwh - python.kpis.total_kwh) /
    python.kpis.total_kwh;
  assert.ok(
    diff <= 0.005,
    `${name}: energy off by ${(diff * 100).toFixed(3)}%`,
  );
  assert.ok(Math.abs(ours.segments.length - python.segments.length) <= 1);
  const n = Math.min(ours.segments.length, python.segments.length);
  for (let i = 0; i < n; i += 1)
    assert.ok(
      Math.abs(ours.segments[i].soc_pct - python.segments[i].soc_pct) <= 0.5,
      `${name}: segment ${i} SoC ${ours.segments[i].soc_pct} vs ${python.segments[i].soc_pct}`,
    );
}

test('matches the FleetVolt Python baseline: Long Beach to Cajon Pass', () => {
  const profile = fixture('polb-cajon-elevation-profile');
  const python = fixture('python-baseline-polb-cajon');
  const result = simulateTrip({
    physics: ECASCADIA,
    coordinates: straightLine([33.754, -118.216], [34.28, -117.47]),
    profile,
    distanceM: profile.at(-1).dist_m,
    conditions: { weather_preset: 'ideal', payload_lbs: 34000 },
    drayageZone: null,
  });
  assertParity('polb-cajon', result, python);
  assert.equal(result.feasibility.verdict, python.feasibility.verdict);
  assert.equal(result.feasibility.tier, python.feasibility.tier);
  assert.equal(result.charging_stops.length, python.charging_stops.length);
});

test('matches the FleetVolt Python baseline: flat highway with regen', () => {
  const route = fixture('flat-highway-elevation-profile');
  const python = fixture('python-baseline-flat-highway');
  const result = simulateTrip({
    physics: ECASCADIA,
    coordinates: route.coordinates,
    profile: route.elevation_profile,
    distanceM: route.distance_m,
    conditions: { weather_preset: 'ideal', payload_lbs: 45000 },
    drayageZone: null,
    includeCharging: false,
  });
  assertParity('flat-highway', result, python);
  assert.ok(
    Math.abs(result.kpis.regen_kwh - python.kpis.regen_kwh) < 0.05,
    'regen energy matches',
  );
});

test('segments cut every 10 miles and split on steep grades', () => {
  const coords = straightLine([34, -118], [34, -117.7]);
  const length = 25 * US_MILE_M;
  const flat = buildSegments(length, coords, [
    { dist_m: 0, elev_m: 0 },
    { dist_m: length, elev_m: 0 },
  ]);
  assert.equal(flat.length, 3);
  // A 1 km climb at 8% inside the first cut gets its own segment.
  const hill = buildSegments(length, coords, [
    { dist_m: 0, elev_m: 0 },
    { dist_m: 5000, elev_m: 0 },
    { dist_m: 6000, elev_m: 80 },
    { dist_m: length, elev_m: 80 },
  ]);
  assert.ok(hill.length > flat.length);
  assert.ok(hill.some((s) => s.grade_pct > 6));
});

test('charge curve dwell follows the OEM power bands', () => {
  const curve = [
    { soc_pct: 10, max_kw: 300 },
    { soc_pct: 50, max_kw: 100 },
  ];
  const r = integrateChargeCurve(curve, 20, 80, 350, 400);
  // 20->50 at 300 kW (120 kWh, 24 min) and 50->80 at 100 kW (120 kWh, 72 min).
  assert.equal(Math.round(r.energyKwh), 240);
  assert.equal(Math.round(r.dwellS / 60), 96);
  assert.equal(Math.round(r.departureSoc), 80);
});

test('greedy planner stops at the nearest heavy-duty charger, or reports the gap', () => {
  const coords = straightLine([34, -119], [34, -116.5]);
  const length = 140 * US_MILE_M;
  const truck = truckParams(ECASCADIA, { payloadLbs: 40000 });
  const segments = buildSegments(length, coords, [
    { dist_m: 0, elev_m: 0 },
    { dist_m: length, elev_m: 0 },
  ]);
  // SoC falls 7 points per segment: crosses 18% at segment 11.
  const socPct = segments.map((_, i) => 100 - 7 * (i + 1));
  const at = segments[11];
  const charger = {
    station_id: 'hd-1',
    lat: at.mid_lat + 0.01,
    lon: at.mid_lon,
    power_kw: 350,
  };
  const planned = planGreedyStops({
    segments,
    socPct,
    coordinates: coords,
    truck,
    chargeCurve: ECASCADIA.charge_curve,
    chargers: [charger],
  });
  assert.equal(planned.stops.length, 1);
  assert.equal(planned.stops[0].station_id, 'hd-1');
  assert.ok(planned.stops[0].departure_soc_pct >= 79);
  const gap = planGreedyStops({
    segments,
    socPct,
    coordinates: coords,
    truck,
    chargeCurve: ECASCADIA.charge_curve,
    chargers: [],
  });
  assert.equal(gap.status.complete, false);
  assert.equal(gap.status.blocking_reason, 'no_charger_in_radius');
});

test('a trip past the battery with no chargers is an infrastructure gap', () => {
  const coords = straightLine([34.15, -119.2], [35.4, -116.0]);
  const length = 260 * US_MILE_M;
  const result = simulateTrip({
    physics: FLEETVOLT_TRUCKS.find((t) => t.id === 'ecascadia_291').physics,
    coordinates: coords,
    profile: [
      { dist_m: 0, elev_m: 0 },
      { dist_m: length, elev_m: 0 },
    ],
    distanceM: length,
    conditions: { payload_lbs: 40000 },
  });
  assert.equal(result.feasibility.verdict, 'infeasible');
  assert.equal(result.feasibility.tier, 'infrastructure_gap');
});

test('the POH drayage zone slows the first segment and raises aux load', () => {
  // From the POH gate east along Hueneme Rd.
  const coords = straightLine([34.149, -119.205], [34.149, -118.9]);
  const length = 18_000;
  const args = {
    physics: ECASCADIA,
    coordinates: coords,
    profile: [
      { dist_m: 0, elev_m: 3 },
      { dist_m: length, elev_m: 3 },
    ],
    distanceM: length,
    includeCharging: false,
  };
  const inPort = simulateTrip(args);
  const open = simulateTrip({ ...args, drayageZone: null });
  assert.ok(inPort.segments[0].speed <= 25);
  assert.ok(inPort.kpis.total_time_s > open.kpis.total_time_s);
});

test('catalog: FleetVolt trucks, baselines, CHE, rail, craft, stable unique ids', () => {
  const ids = FLEET_MODELS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const m of FLEET_MODELS) {
    assert.ok(FLEET_CATEGORIES[m.category], `${m.id} category`);
    assert.ok(['mile', 'hour', 'ton-mile'].includes(m.basis), `${m.id} basis`);
    assert.ok(m.source, `${m.id} has a source`);
    if (m.assetClass)
      assert.ok(ASSET_CLASSES[m.assetClass], `${m.id} asset class exists`);
  }
  assert.equal(
    FLEET_MODELS.filter((m) => m.physicsId).length,
    FLEETVOLT_TRUCKS.length,
  );
  for (const id of [
    DEFAULT_DIESEL_DRAYAGE_ID,
    DEFAULT_BEV_DRAYAGE_ID,
    DEFAULT_LINE_HAUL_ID,
    'truck-diesel-reefer',
    'truck-diesel-auto-carrier',
    'che-utr-electric',
    'che-harbor-crane',
    'che-rtg-crane-electric',
    'che-straddle-carrier-diesel',
    'loco-switcher-diesel',
    'craft-tug-electric',
  ])
    assert.ok(fleetModel(id), `${id} exists`);
  assert.equal(
    physicsTruckOf(fleetModel(DEFAULT_BEV_DRAYAGE_ID)).id,
    'ecascadia_438',
  );
});

test('emissions: diesel per mile, BEV grid only, per ton-mile for the footprint', () => {
  const diesel = emissionsPerUnit(fleetModel(DEFAULT_DIESEL_DRAYAGE_ID));
  assert.ok(Math.abs(diesel.co2eKg - 10.21 / 6.5) < 1e-9);
  assert.equal(diesel.noxG, 3);
  const bev = emissionsPerUnit(fleetModel(DEFAULT_BEV_DRAYAGE_ID));
  assert.equal(bev.noxG, 0);
  assert.ok(bev.co2eKg > 0 && bev.co2eKg < diesel.co2eKg);
  const perTon = emissionsPerTonMile(fleetModel(DEFAULT_DIESEL_DRAYAGE_ID));
  assert.ok(Math.abs(perTon.co2eKg - diesel.co2eKg / 16) < 1e-9);
  const rail = emissionsPerTonMile(fleetModel(DEFAULT_LINE_HAUL_ID));
  assert.ok(rail.co2eKg < perTon.co2eKg / 3, 'rail beats trucks per ton-mile');
  const reefer = emissionsPerUnit(fleetModel('truck-diesel-reefer'));
  assert.ok(reefer.co2eKg > diesel.co2eKg, 'genset adds fuel');
  // Electric UTR vs diesel UTR, 2,000 hours a year.
  const utr = compareAnnual(
    fleetModel('che-utr-electric'),
    fleetModel('che-utr-diesel'),
    { units: 10, perUnitYear: 2000 },
  );
  assert.ok(utr.avoided.co2eT > 0);
  assert.equal(utr.ze.noxKg, 0);
  assert.equal(utr.gridKwh, 12.5 * 2000 * 10);
});

test('ship models group the POH inventory by EPA type', () => {
  const inventory = JSON.parse(
    readFileSync(
      new URL(
        '../../../public/data/vessels/port-of-hueneme.json',
        import.meta.url,
      ),
    ),
  );
  const ships = ogvModels(inventory);
  assert.ok(ships.length > 1);
  const total = ships.reduce((n, m) => n + m.ships.length, 0);
  assert.equal(
    total,
    inventory.vessels.filter((v) => v.engines?.epa?.shipType).length,
  );
  assert.ok(ships.every((m) => m.hotellingAuxKw > 0));
  const catalog = buildFleetCatalog({ vesselInventory: inventory });
  assert.ok(catalog.byId.get(ships[0].id));
  assert.ok(emissionsPerUnit(ships[0]).noxG > 0);
});

test('asset registry: equipment classes pick a catalog model; drayage trucks validate', () => {
  for (const cls of [
    'utr',
    'mobile_harbor_crane',
    'locomotive',
    'tug',
    'drayage_truck',
    'rtg_crane',
  ]) {
    const pick = ASSET_CLASSES[cls].fields.find((x) => x.key === 'catalogId');
    assert.ok(pick, `${cls} has a catalog picker`);
    assert.deepEqual(
      pick.options.map((o) => o.value),
      modelsForAssetClass(cls).map((m) => m.id),
    );
  }
  const registry = {
    ...HUENEME_REGISTRY,
    assets: [
      ...HUENEME_REGISTRY.assets,
      {
        id: 'dray-fleet-1',
        class: 'drayage_truck',
        powertrain: 'diesel',
        units: 40,
        catalogId: DEFAULT_DIESEL_DRAYAGE_ID,
      },
    ],
  };
  assert.deepEqual(validateRegistry(registry).errors ?? [], []);
});
