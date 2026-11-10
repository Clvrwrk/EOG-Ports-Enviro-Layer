import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  commodityTonnes,
  freightFootprint,
  greatCircleKm,
  oceanIntensity,
  pathKm,
  portCallIntensity,
  railLeg,
  seaRoute,
  seaRouteLine,
  truckLeg,
  truckPerMile,
} from './freightFootprint.js';
import {
  COMMODITIES,
  DROP_SITES,
  MARKETS,
  ORIGINS,
  REPRESENTATIVE_SHIPS,
} from './freightLanes.js';

const close = (actual, expected, tol) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${expected} ± ${tol}, got ${actual}`,
  );

test('great-circle distance matches a known pair', () => {
  // Los Angeles to New York is about 3,936 km.
  close(greatCircleKm([33.94, -118.41], [40.64, -73.78]), 3974, 40);
});

test('sea routes reach Hueneme at believable distances', () => {
  const nm = (id) => pathKm(seaRoute(id)) / 1.852;
  close(nm('kr-pyeongtaek'), 5600, 400);
  close(nm('de-bremerhaven'), 8000, 500); // via Panama
  close(nm('gt-puerto-quetzal'), 2100, 250);
  const line = seaRouteLine('jp-nagoya');
  assert.ok(line.length > 20);
  assert.deepEqual(line[0], [
    ORIGINS['jp-nagoya'].lat,
    ORIGINS['jp-nagoya'].lon,
  ]);
});

test('representative ships match the Hueneme ship inventory', () => {
  const inventory = JSON.parse(
    readFileSync(
      new URL(
        '../../public/data/vessels/port-of-hueneme.json',
        import.meta.url,
      ),
    ),
  );
  for (const ship of Object.values(REPRESENTATIVE_SHIPS)) {
    const v = inventory.vessels.find((x) => String(x.imo) === String(ship.imo));
    assert.ok(v, `${ship.name} is in the inventory`);
    assert.equal(v.engines.main.kw, ship.installedKw);
    assert.equal(v.particulars.deadweight, ship.deadweight);
    assert.equal(v.engines.epa.shipType, ship.shipType);
    assert.equal(v.engines.epa.subtype, ship.subtype);
  }
});

test('every lane points at a known origin, drop site and market, with shares', () => {
  for (const c of Object.values(COMMODITIES)) {
    assert.ok(REPRESENTATIVE_SHIPS[c.shipClass]);
    for (const id of Object.keys(c.origins)) assert.ok(ORIGINS[id], id);
    for (const id of Object.keys(c.dropSites)) assert.ok(DROP_SITES[id], id);
    for (const id of Object.keys(c.markets)) assert.ok(MARKETS[id], id);
    const sum = (o) =>
      Object.values(o).reduce((s, v) => s + (Array.isArray(v) ? v[0] : v), 0);
    close(sum(c.dropSites), 1, 1e-9);
    close(sum(c.markets), 1, 1e-9);
  }
  assert.equal(commodityTonnes(COMMODITIES.autos), 380_000 * 1.9);
});

test('diesel truck CO2 per mile follows from 10.21 kg/gal at 6.5 mpg', () => {
  const d = truckPerMile('diesel');
  close(d.tonnes.co2 * 1e6, 10210 / 6.5, 1e-6);
  const e = truckPerMile('electric');
  close(e.tonnes.co2e * 1e6, 2.0 * 240, 1e-6);
  assert.equal(e.tonnes.nox, 0);
});

test('a truck leg counts the empty return and loads', () => {
  const leg = truckLeg({
    tonnes: 200,
    miles: 10,
    payloadT: 20,
    emptyReturn: 1,
  });
  assert.equal(leg.trips, 10);
  assert.equal(leg.vehicleMiles, 200);
  close(leg.tonnes.co2, 200 * (10.21 / 6.5 / 1000), 1e-9);
});

test('rail uses ton-miles per gallon', () => {
  const leg = railLeg({ tonnes: 470, miles: 100 });
  close(leg.dieselGallons, 100, 1e-9);
  close(leg.tonnes.co2, 1.021, 1e-9);
});

test('ocean and port legs share a ship across the cargo it carries', () => {
  const ship = REPRESENTATIVE_SHIPS.reefer;
  const ocean = oceanIntensity(ship, 2000);
  assert.equal(ocean.warnings.length, 0);
  close(ocean.payloadT, ship.deadweight * ship.utilization, 1e-9);
  close(ocean.perTonne.co2, ocean.perVoyage.co2 / ocean.payloadT, 1e-12);
  // Twice the distance, about twice the voyage.
  const far = oceanIntensity(ship, 4000);
  close(far.perVoyage.co2 / ocean.perVoyage.co2, 2, 0.05);
  const call = portCallIntensity(ship);
  assert.ok(call.perCall.co2 > call.tugs.co2);
  close(
    call.perTonne.co2,
    call.perCall.co2 / (ship.deadweight * ship.utilization * ship.pohShare),
    1e-12,
  );
});

test('the footprint adds up by leg and by commodity', () => {
  const f = freightFootprint();
  const legSum = Object.values(f.byLeg).reduce((s, v) => s + v.co2e, 0);
  close(f.totals.co2e, legSum, 1e-6);
  const comSum = Object.values(f.byCommodity).reduce(
    (s, c) => s + c.total.co2e,
    0,
  );
  close(f.totals.co2e, comSum, 1e-6);
  // Ocean dominates; drayage is a sliver; every leg is positive.
  for (const v of Object.values(f.byLeg)) assert.ok(v.co2e > 0);
  assert.ok(f.byLeg.ocean.co2e > f.byLeg.onward.co2e);
  assert.ok(f.byLeg.onward.co2e > f.byLeg.drayage.co2e);
  // Cargo conserved through the drop sites.
  const drayageT = f.flows
    .filter((x) => x.leg === 'drayage')
    .reduce((s, x) => s + x.tonnes, 0);
  close(drayageT, f.cargoTonnes, 1e-6);
});

test('battery-electric drayage cuts drayage CO2e and tailpipe NOx', () => {
  const base = freightFootprint();
  const bev = freightFootprint({ scenario: { drayage: 'electric' } });
  assert.ok(bev.byLeg.drayage.co2e < base.byLeg.drayage.co2e);
  assert.equal(bev.byLeg.drayage.nox, 0);
  assert.ok(bev.energy.gridKwh > 0);
  close(bev.byLeg.ocean.co2e, base.byLeg.ocean.co2e, 1e-9);
});

test('truck factors can be replaced (the EV Planning catalog hook)', () => {
  const doubled = freightFootprint({
    truckFactors: {
      diesel: {
        id: 'x',
        label: 'x',
        mpg: 3.25,
        kgCo2PerGallon: 10.21,
        bhpHrPerGallon: 20.8,
        noxGPerBhpHr: 0.2,
        pmGPerBhpHr: 0.01,
      },
      electric: { id: 'y', label: 'y', kwhPerMile: 2, gridKgCo2ePerKwh: 0.24 },
    },
  });
  const base = freightFootprint();
  close(doubled.byLeg.drayage.co2e / base.byLeg.drayage.co2e, 2, 1e-9);
});
