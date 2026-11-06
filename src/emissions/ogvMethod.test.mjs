import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GWP_SETS,
  defaultFuelSulfur,
  defaultHotelLoads,
  engineEmissionFactors,
  hourlyShorePowerLoad,
  intervalEmissions,
  lowLoadAdjustment,
  operatingMode,
  propulsionLoad,
  subtypeFor,
  summarize,
} from './ogvMethod.js';
import {
  DEFAULT_AUX_KW,
  DEFAULT_BOILER_KW,
  noxTierForKeelYear,
} from './ogvFactors.js';

const close = (actual, expected, tol = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${expected}, got ${actual}`,
  );

test('keel-laid year maps to the Table 3.5 NOx tier rows', () => {
  assert.equal(noxTierForKeelYear(1998), 'pre-tier');
  assert.equal(noxTierForKeelYear(2000), 'tier1');
  assert.equal(noxTierForKeelYear(2010), 'tier1');
  assert.equal(noxTierForKeelYear(2011), 'tier2');
  assert.equal(noxTierForKeelYear(2016), 'tier3');
  assert.equal(noxTierForKeelYear(undefined), null);
});

test('auxiliary MSD factors on 0.1% sulfur distillate follow Equations 3.3-3.5', () => {
  const { factors, bsfc, missing } = engineEmissionFactors({
    group: 'auxiliary',
    fuel: 'MGO/MDO',
    engineType: 'MSD',
    keelYear: 2012,
    fuelSulfur: 0.001,
  });
  assert.deepEqual(missing, []);
  assert.equal(bsfc, 217);
  assert.equal(factors.nox, 10.5);
  close(factors.pm10, 0.1545 + 0.001 * 217 * 0.02247 * 7);
  close(factors.pm25, factors.pm10 * 0.92);
  assert.equal(factors.dpm, factors.pm10);
  close(factors.so2, 217 * 0.001 * 0.97753 * 2);
  close(factors.co2, 217 * 3.206);
  close(factors.voc, 0.4 * 1.053);
  close(factors.ch4, 0.4 * 0.02);
});

test('Tier III propulsion below 25% load uses Tier II NOx', () => {
  const base = {
    group: 'propulsion',
    fuel: 'MGO/MDO',
    engineType: 'SSD',
    keelYear: 2018,
    fuelSulfur: 0.001,
  };
  assert.equal(engineEmissionFactors(base).factors.nox, 3.4);
  assert.equal(
    engineEmissionFactors({ ...base, belowTier3Threshold: true }).factors.nox,
    14.4,
  );
});

test('boilers and turbines report no DPM because they are not diesel engines', () => {
  const boiler = engineEmissionFactors({
    group: 'boiler',
    fuel: 'MGO/MDO',
    engineType: 'Boiler',
    fuelSulfur: 0.001,
  });
  assert.equal(boiler.factors.dpm, 0);
  assert.ok(boiler.factors.pm10 > 0);
  const gt = engineEmissionFactors({
    group: 'propulsion',
    fuel: 'MGO/MDO',
    engineType: 'GT',
    fuelSulfur: 0.001,
  });
  assert.equal(gt.factors.pm10, 0.01);
  assert.equal(gt.factors.dpm, 0);
});

test('missing keel year is reported rather than guessed', () => {
  const { factors, missing } = engineEmissionFactors({
    group: 'auxiliary',
    fuel: 'MGO/MDO',
    engineType: 'MSD',
    fuelSulfur: 0.001,
  });
  assert.equal(factors.nox, null);
  assert.ok(missing.includes('keelYear'));
});

test('propeller law and admiralty formula (Equations 3.6-3.8)', () => {
  const law = propulsionLoad({
    installedKw: 10_000,
    speedKn: 10,
    maxSpeedKn: 20,
  });
  close(law.kw, 10_000 * 0.125 * 1.1);
  close(law.loadFactor, 0.1375);
  assert.match(law.method, /propeller law/);

  const adm = propulsionLoad({
    installedKw: 10_000,
    speedKn: 10,
    maxSpeedKn: 20,
    draftM: 8,
    maxDraftM: 12,
  });
  close(adm.kw, 10_000 * 0.125 * (8 / 12) ** (2 / 3) * 1.1);
  assert.match(adm.method, /admiralty/);

  const fromService = propulsionLoad({
    installedKw: 10_000,
    speedKn: 18.8,
    serviceSpeedKn: 18.8,
  });
  close(fromService.loadFactor, Math.min(1, 0.94 ** 3 * 1.1));

  const capped = propulsionLoad({
    installedKw: 10_000,
    speedKn: 25,
    maxSpeedKn: 20,
  });
  assert.equal(capped.kw, 10_000);

  assert.equal(propulsionLoad({ speedKn: 10, maxSpeedKn: 20 }).kw, null);
});

test('low load adjustment uses Table 3.10 rows and flags non-0.1% sulfur SO2', () => {
  assert.equal(lowLoadAdjustment(0.5).nox, 1);
  assert.equal(lowLoadAdjustment(0.1375).nox, 1.08);
  assert.equal(lowLoadAdjustment(0.01).pm, 7.29);
  assert.equal(lowLoadAdjustment(0.05).so2, 3.85);
  const highSulfur = lowLoadAdjustment(0.05, 0.005);
  assert.equal(highSulfur.so2Approximate, true);
  assert.equal(highSulfur.so2, 1);
});

test('operating modes follow Table 3.11', () => {
  assert.equal(operatingMode({ zone: 'berth', speedKn: 0.2 }), 'hotelling');
  assert.equal(operatingMode({ zone: 'berth', speedKn: 3 }), 'maneuvering');
  assert.equal(operatingMode({ zone: 'harbor', speedKn: 5 }), 'maneuvering');
  assert.equal(operatingMode({ zone: 'anchorage', speedKn: 1 }), 'anchorage');
  assert.equal(
    operatingMode({ zone: 'approach', speedKn: 14, loadFactor: 0.45 }),
    'transit',
  );
  assert.equal(
    operatingMode({ zone: 'approach', speedKn: 6, loadFactor: 0.1 }),
    'maneuvering',
  );
  assert.equal(operatingMode({ zone: null, speedKn: 14 }), null);
});

test('Table 3.4 subtypes and Appendix E loads line up for every subtype', () => {
  assert.equal(subtypeFor('Vehicle Carrier', { vehicles: 6500 }), 'Largest');
  assert.equal(subtypeFor('Container Ship', { teu: 2500 }), '3,000 TEU');
  assert.equal(subtypeFor('Reefer'), 'All Reefer');
  assert.equal(subtypeFor('Container Ship', {}), null);
  for (const [type, subtypes] of Object.entries(DEFAULT_AUX_KW)) {
    for (const subtype of Object.keys(subtypes)) {
      assert.ok(
        DEFAULT_BOILER_KW[type]?.[subtype],
        `boiler row missing for ${type} / ${subtype}`,
      );
    }
  }
  assert.deepEqual(
    {
      aux: defaultHotelLoads('Reefer', 'All Reefer', 'hotelling').auxKw,
      boiler: defaultHotelLoads('Reefer', 'All Reefer', 'hotelling').boilerKw,
    },
    { aux: 1080, boiler: 270 },
  );
});

test('fuel sulfur defaults follow the ECA rules', () => {
  assert.equal(defaultFuelSulfur(2024, true), 0.001);
  assert.equal(defaultFuelSulfur(2024, false), 0.005);
  assert.equal(defaultFuelSulfur(2018, false), 0.027);
  assert.equal(defaultFuelSulfur(2010, true), null);
});

const carCarrier = {
  shipType: 'Vehicle Carrier',
  subtype: 'Largest',
  keelYear: 2012,
  fuel: 'MGO/MDO',
  propulsion: { engineType: 'SSD', installedKw: 14_000, maxSpeedKn: 21 },
  auxiliary: { engineType: 'MSD' },
};

test('shore power moves the auxiliary load to the grid and leaves boilers on fuel', () => {
  const plugged = intervalEmissions(carCarrier, {
    hours: 10,
    mode: 'hotelling',
    fuelSulfur: 0.001,
    onShorePower: true,
  });
  assert.equal(plugged.energyKwh.shorePower, 8000);
  assert.equal(plugged.energyKwh.auxiliary, 0);
  assert.equal(plugged.grams.auxiliary.nox, 0);
  assert.equal(plugged.energyKwh.boiler, 2680);
  close(plugged.grams.boiler.nox, 2680 * 2.0);

  const engines = intervalEmissions(carCarrier, {
    hours: 10,
    mode: 'hotelling',
    fuelSulfur: 0.001,
  });
  assert.equal(engines.energyKwh.shorePower, 0);
  close(engines.grams.auxiliary.nox, 8000 * 10.5);
});

test('transit applies propulsion emissions with low-load adjustment', () => {
  const r = intervalEmissions(carCarrier, {
    hours: 1,
    mode: 'maneuvering',
    speedKn: 5,
    fuelSulfur: 0.001,
  });
  const lf = (5 / 21) ** 3 * 1.1;
  close(r.propulsion.loadFactor, lf);
  const llaf = lowLoadAdjustment(lf).nox;
  close(r.grams.propulsion.nox, 14_000 * lf * 1 * 14.4 * llaf, 1e-6);
  assert.deepEqual(r.warnings, []);
});

test('summaries convert to tonnes and report the GWP set used for CO2e', () => {
  const results = [
    intervalEmissions(carCarrier, {
      hours: 2,
      mode: 'maneuvering',
      speedKn: 6,
      fuelSulfur: 0.001,
    }),
    intervalEmissions(carCarrier, {
      hours: 20,
      mode: 'hotelling',
      fuelSulfur: 0.001,
    }),
  ];
  const s = summarize(results, GWP_SETS.AR4);
  assert.equal(s.gwp.id, 'AR4');
  close(s.tonnes.co2e, s.tonnes.co2 + 25 * s.tonnes.ch4 + 298 * s.tonnes.n2o);
  close(s.byMode.hotelling.hours, 20);
  assert.ok(s.tonnes.nox > 0);
});

test('hourly shore-power load splits intervals across clock hours', () => {
  const t0 = Date.parse('2024-05-01T10:30:00Z');
  const load = hourlyShorePowerLoad([
    { startMs: t0, endMs: t0 + 90 * 60_000, auxKw: 800 },
  ]);
  assert.deepEqual(
    load.map((h) => h.kw),
    [400, 800],
  );
});
