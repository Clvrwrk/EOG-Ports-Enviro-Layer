// Ocean-going vessel emissions and shore-power load, following EPA's Port
// Emissions Inventory Guidance (EPA-420-B-22-011), Section 3.8 "AIS Inventory
// Calculations". Pure functions only: no network, no globe, no clock.
//
// Every result carries the inputs and factors that produced it, so the UI can
// show a "method card" for any number and anyone can recompute it by hand.

import {
  BC_SHARE_OF_PM10,
  BSFC_G_PER_KWH,
  CARBON_CONTENT_FACTOR,
  CH4_SHARE_OF_HC,
  DEFAULT_AUX_KW,
  DEFAULT_BOILER_KW,
  DEFAULT_FUEL_SULFUR,
  HC_CO_G_PER_KWH,
  LOW_LOAD_ADJUSTMENT,
  N2O_G_PER_KWH,
  NOX_G_PER_KWH,
  OGV_FACTOR_SOURCE,
  PM10_FIXED_G_PER_KWH,
  PM25_SHARE_OF_PM10,
  PM_EQUATION,
  SEA_MARGIN,
  SERVICE_TO_MAX_SPEED,
  SINGLE_SUBTYPE,
  SO2_EQUATION,
  SUBTYPE_BREAKS,
  VOC_PER_HC,
  noxTierForKeelYear,
} from './ogvFactors.js';

export const POLLUTANTS = Object.freeze([
  'nox',
  'pm10',
  'pm25',
  'dpm',
  'bc',
  'hc',
  'voc',
  'ch4',
  'co',
  'n2o',
  'co2',
  'so2',
]);

/**
 * 100-year global warming potentials. The guidance does not fix a set, so the
 * caller chooses; the set used is reported with every CO2e figure.
 */
export const GWP_SETS = Object.freeze({
  AR4: Object.freeze({
    id: 'AR4',
    label: 'IPCC AR4 (100-year)',
    ch4: 25,
    n2o: 298,
  }),
  AR5: Object.freeze({
    id: 'AR5',
    label: 'IPCC AR5 (100-year)',
    ch4: 28,
    n2o: 265,
  }),
});

const finite = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Table 3.4: map ship type + size to the subtype used by Appendix E. */
export function subtypeFor(shipType, size = {}) {
  if (SINGLE_SUBTYPE[shipType]) return SINGLE_SUBTYPE[shipType];
  const rule = SUBTYPE_BREAKS[shipType];
  if (!rule) return null;
  const value = finite(size[rule.unit]);
  if (value === null) return null;
  for (const [upper, subtype] of rule.bands) if (value < upper) return subtype;
  return null;
}

/** Appendix E default auxiliary and boiler loads (kW) for one mode. */
export function defaultHotelLoads(shipType, subtype, mode) {
  const aux = DEFAULT_AUX_KW[shipType]?.[subtype]?.[mode];
  const boiler = DEFAULT_BOILER_KW[shipType]?.[subtype]?.[mode];
  if (aux === undefined || boiler === undefined) return null;
  return {
    auxKw: aux,
    boilerKw: boiler,
    source: `${OGV_FACTOR_SOURCE.edition}, Appendix E Tables E.1 and E.2 (${shipType}, ${subtype}, ${mode})`,
  };
}

/** Default fuel sulfur for a year and location (Equations 3.3 and 3.5). */
export function defaultFuelSulfur(year, insideEca = true) {
  if (insideEca && year >= 2015) return DEFAULT_FUEL_SULFUR.insideEcaFrom2015;
  if (!insideEca && year >= 2020) return DEFAULT_FUEL_SULFUR.outsideEcaFrom2020;
  if (!insideEca) return DEFAULT_FUEL_SULFUR.outsideEcaBefore2020;
  // Inside the ECA before 2015 the guidance says to use actual sulfur levels.
  return null;
}

const pickNox = (group, fuel, engineType, tier) => {
  const byType = NOX_G_PER_KWH[group]?.[fuel]?.[engineType];
  if (!byType) return null;
  if (byType.any !== undefined) return byType.any;
  return tier ? (byType[tier] ?? null) : null;
};

/**
 * Emission factors (g/kWh) for one engine, from Tables 3.5-3.9 and Equations
 * 3.3-3.5. `belowTier3Threshold` applies the Table 3.5 footnote: Tier III
 * propulsion engines under 25% load use Tier II factors.
 */
export function engineEmissionFactors({
  group,
  fuel,
  engineType,
  keelYear,
  fuelSulfur,
  belowTier3Threshold = false,
}) {
  const missing = [];
  let tier = noxTierForKeelYear(keelYear);
  if (group === 'propulsion' && tier === 'tier3' && belowTier3Threshold)
    tier = 'tier2';

  const bsfc = BSFC_G_PER_KWH[group]?.[fuel]?.[engineType] ?? null;
  if (bsfc === null) missing.push('bsfc');

  const nox = pickNox(group, fuel, engineType, tier);
  if (nox === null) missing.push(tier ? 'nox' : 'keelYear');

  const sulfur = fuel === 'LNG' ? 0 : finite(fuelSulfur);
  if (sulfur === null) missing.push('fuelSulfur');

  let pm10 = null;
  const fixedPm = PM10_FIXED_G_PER_KWH[fuel]?.[engineType];
  if (fixedPm !== undefined) pm10 = fixedPm;
  else if (
    bsfc !== null &&
    sulfur !== null &&
    PM_EQUATION.baseGPerKwh[fuel] !== undefined
  ) {
    pm10 =
      PM_EQUATION.baseGPerKwh[fuel] +
      sulfur *
        bsfc *
        PM_EQUATION.fractionToSulfatePm *
        PM_EQUATION.sulfatePmToSulfurWeightRatio;
  }
  if (pm10 === null) missing.push('pm10');

  const hcCo = HC_CO_G_PER_KWH[group]?.[engineType] ?? null;
  if (!hcCo) missing.push('hc', 'co');
  const n2o = N2O_G_PER_KWH[group]?.[fuel]?.[engineType] ?? null;
  if (n2o === null) missing.push('n2o');

  const isDiesel = ['SSD', 'MSD', 'HSD'].includes(engineType);
  const factors = {
    nox,
    pm10,
    pm25: pm10 === null ? null : pm10 * PM25_SHARE_OF_PM10,
    // Section 3.5.3: DPM equals PM for compression-ignition engines only.
    dpm: pm10 === null ? null : isDiesel ? pm10 : 0,
    bc: pm10 === null ? null : pm10 * BC_SHARE_OF_PM10,
    hc: hcCo ? hcCo.hc : null,
    voc: hcCo ? hcCo.hc * VOC_PER_HC : null,
    ch4: hcCo ? hcCo.hc * CH4_SHARE_OF_HC : null,
    co: hcCo ? hcCo.co : null,
    n2o,
    co2: bsfc === null ? null : bsfc * CARBON_CONTENT_FACTOR[fuel],
    so2:
      bsfc === null || sulfur === null
        ? null
        : bsfc *
          sulfur *
          SO2_EQUATION.fractionToSo2 *
          SO2_EQUATION.so2ToSulfurWeightRatio,
  };
  return {
    factors,
    bsfc,
    tier,
    missing: [...new Set(missing)],
    source: `${OGV_FACTOR_SOURCE.edition}, Tables 3.5-3.9 and Equations 3.3-3.5`,
  };
}

/**
 * Propulsion operating power and load factor (Equations 3.6-3.8). Uses the
 * admiralty formula when both drafts are known, otherwise the propeller law.
 */
export function propulsionLoad({
  installedKw,
  speedKn,
  maxSpeedKn,
  serviceSpeedKn,
  draftM,
  maxDraftM,
  seaMargin = SEA_MARGIN.coastal,
}) {
  const pRef = finite(installedKw);
  const vRef =
    finite(maxSpeedKn) ??
    (finite(serviceSpeedKn) === null
      ? null
      : serviceSpeedKn / SERVICE_TO_MAX_SPEED);
  const v = finite(speedKn);
  if (
    pRef === null ||
    pRef <= 0 ||
    vRef === null ||
    vRef <= 0 ||
    v === null ||
    v < 0
  ) {
    return { kw: null, loadFactor: null, method: null };
  }
  // Section 3.8.2: speeds above 1.5 x max use the maximum speed.
  const speed = v > 1.5 * vRef ? vRef : v;
  const d = finite(draftM);
  const dRef = finite(maxDraftM);
  const useAdmiralty = d !== null && dRef !== null && d > 0 && dRef > 0;
  const draftTerm = useAdmiralty ? Math.min(d / dRef, 1) ** (2 / 3) : 1;
  const raw = pRef * (speed / vRef) ** 3 * draftTerm * seaMargin;
  const kw = Math.min(raw, pRef);
  return {
    kw,
    loadFactor: kw / pRef,
    method: useAdmiralty
      ? 'admiralty formula (Eq. 3.7)'
      : 'propeller law (Eq. 3.6)',
  };
}

/** Table 3.10 low load adjustment factors; SO2 values are valid for 0.1% sulfur only. */
export function lowLoadAdjustment(
  loadFactor,
  fuelSulfur = DEFAULT_FUEL_SULFUR.insideEcaFrom2015,
) {
  const ones = { nox: 1, hc: 1, co: 1, pm: 1, co2: 1, so2: 1 };
  const lf = finite(loadFactor);
  if (lf === null || lf >= 0.2) return { ...ones, so2Approximate: false };
  const pct = Math.max(2, Math.min(19, Math.round(lf * 100)));
  const row = LOW_LOAD_ADJUSTMENT[pct];
  const so2Exact = Math.abs((fuelSulfur ?? 0) - 0.001) < 1e-9;
  return {
    ...row,
    // Appendix F gives SO2 LLAFs for other sulfur levels; not yet transcribed.
    so2: so2Exact ? row.so2 : 1,
    so2Approximate: !so2Exact,
  };
}

/** Which LLAF column scales each pollutant (Section 3.7). */
const LLAF_COLUMN = Object.freeze({
  nox: 'nox',
  n2o: 'nox',
  hc: 'hc',
  voc: 'hc',
  ch4: 'hc',
  co: 'co',
  pm10: 'pm',
  pm25: 'pm',
  dpm: 'pm',
  bc: 'pm',
  co2: 'co2',
  so2: 'so2',
});

/**
 * Operating mode per Table 3.11. `zone` comes from the port's geofences:
 * 'berth', 'anchorage', 'harbor' (inside the breakwater) or 'approach'.
 */
export function operatingMode({ zone, speedKn, loadFactor }) {
  const v = finite(speedKn);
  if (zone === 'berth' && (v === null || v <= 1)) return 'hotelling';
  if (zone === 'anchorage' && (v === null || v <= 3)) return 'anchorage';
  if (zone === 'harbor' || zone === 'berth' || zone === 'anchorage')
    return 'maneuvering';
  if (zone === 'approach') {
    const lf = finite(loadFactor);
    if (lf !== null && lf <= 0.2 && v !== null && v > 1) return 'maneuvering';
    return 'transit';
  }
  return null;
}

const emptyTotals = () => Object.fromEntries(POLLUTANTS.map((p) => [p, 0]));

const addScaled = (totals, factors, kwh, llaf) => {
  for (const pollutant of POLLUTANTS) {
    const ef = factors[pollutant];
    if (ef === null || ef === undefined) continue;
    const adjust = llaf ? (llaf[LLAF_COLUMN[pollutant]] ?? 1) : 1;
    totals[pollutant] += ef * kwh * adjust;
  }
};

/**
 * Emissions (grams) and grid electricity (kWh) for one vessel over one
 * interval of `hours` in one operating mode.
 *
 * vessel: { shipType, subtype, keelYear, fuel, propulsion: { engineType,
 *   installedKw, maxSpeedKn?, serviceSpeedKn?, maxDraftM? },
 *   auxiliary: { engineType }, auxKw?, boilerKw?, shorePowerCapable? }
 * interval: { hours, mode, speedKn?, draftM?, fuelSulfur, onShorePower? }
 */
export function intervalEmissions(vessel, interval) {
  const warnings = [];
  const hours = finite(interval.hours);
  if (hours === null || hours < 0)
    throw new TypeError('interval.hours must be a non-negative number');
  const mode = interval.mode;
  const fuel = vessel.fuel ?? 'MGO/MDO';
  const fuelSulfur = interval.fuelSulfur;
  const grams = {
    propulsion: emptyTotals(),
    auxiliary: emptyTotals(),
    boiler: emptyTotals(),
  };
  const energyKwh = { propulsion: 0, auxiliary: 0, boiler: 0, shorePower: 0 };
  let propulsion = null;

  if (mode === 'transit' || mode === 'maneuvering') {
    const p = vessel.propulsion ?? {};
    propulsion = propulsionLoad({
      installedKw: p.installedKw,
      speedKn: interval.speedKn,
      maxSpeedKn: p.maxSpeedKn,
      serviceSpeedKn: p.serviceSpeedKn,
      draftM: interval.draftM,
      maxDraftM: p.maxDraftM,
    });
    if (propulsion.kw === null) {
      warnings.push(
        'propulsion: installed power or speed unknown; propulsion emissions omitted',
      );
    } else {
      const ef = engineEmissionFactors({
        group: 'propulsion',
        fuel,
        engineType: p.engineType,
        keelYear: vessel.keelYear,
        fuelSulfur,
        belowTier3Threshold: propulsion.loadFactor < 0.25,
      });
      if (ef.missing.length)
        warnings.push(`propulsion factors missing: ${ef.missing.join(', ')}`);
      const llaf = lowLoadAdjustment(propulsion.loadFactor, fuelSulfur);
      if (llaf.so2Approximate)
        warnings.push(
          'SO2 low-load factor needs Appendix F for this sulfur level',
        );
      const kwh = propulsion.kw * hours;
      energyKwh.propulsion = kwh;
      addScaled(grams.propulsion, ef.factors, kwh, llaf);
      propulsion = { ...propulsion, tier: ef.tier, llaf };
    }
  }

  const defaults = defaultHotelLoads(vessel.shipType, vessel.subtype, mode);
  const auxKw = finite(vessel.auxKw?.[mode]) ?? defaults?.auxKw ?? null;
  const boilerKw =
    finite(vessel.boilerKw?.[mode]) ?? defaults?.boilerKw ?? null;
  if (auxKw === null || boilerKw === null) {
    warnings.push(
      `no auxiliary/boiler load for ${vessel.shipType} / ${vessel.subtype} / ${mode}`,
    );
  }

  if (auxKw !== null) {
    const auxKwh = auxKw * hours;
    // Shore power replaces auxiliary engines while hotelling (Section 3.6.4).
    // Boilers keep running on fuel. Grid kWh excludes conversion losses.
    if (mode === 'hotelling' && interval.onShorePower) {
      energyKwh.shorePower = auxKwh;
    } else {
      const ef = engineEmissionFactors({
        group: 'auxiliary',
        fuel,
        engineType: vessel.auxiliary?.engineType ?? 'MSD',
        keelYear: vessel.keelYear,
        fuelSulfur,
      });
      if (ef.missing.length)
        warnings.push(`auxiliary factors missing: ${ef.missing.join(', ')}`);
      energyKwh.auxiliary = auxKwh;
      addScaled(grams.auxiliary, ef.factors, auxKwh, null);
    }
  }
  if (boilerKw !== null && boilerKw > 0 && fuel !== 'LNG') {
    const ef = engineEmissionFactors({
      group: 'boiler',
      fuel,
      engineType: 'Boiler',
      fuelSulfur,
    });
    const boilerKwh = boilerKw * hours;
    energyKwh.boiler = boilerKwh;
    addScaled(grams.boiler, ef.factors, boilerKwh, null);
  }

  return {
    mode,
    hours,
    grams,
    energyKwh,
    propulsion,
    auxKw,
    boilerKw,
    warnings,
  };
}

/** Sum interval results and convert grams to metric tonnes. */
export function summarize(results, gwpSet = GWP_SETS.AR5) {
  const tonnes = emptyTotals();
  const byMode = {};
  const energyKwh = { propulsion: 0, auxiliary: 0, boiler: 0, shorePower: 0 };
  const warnings = new Set();
  for (const r of results) {
    byMode[r.mode] ??= { hours: 0, tonnes: emptyTotals() };
    byMode[r.mode].hours += r.hours;
    for (const group of Object.values(r.grams)) {
      for (const p of POLLUTANTS) {
        tonnes[p] += group[p] / 1e6;
        byMode[r.mode].tonnes[p] += group[p] / 1e6;
      }
    }
    for (const key of Object.keys(energyKwh))
      energyKwh[key] += r.energyKwh[key];
    for (const w of r.warnings) warnings.add(w);
  }
  const co2e = tonnes.co2 + tonnes.ch4 * gwpSet.ch4 + tonnes.n2o * gwpSet.n2o;
  return {
    tonnes: { ...tonnes, co2e },
    byMode,
    energyKwh,
    gwp: gwpSet,
    warnings: [...warnings],
  };
}

/**
 * Hourly shore-power demand (kW) from hotelling intervals that were on shore
 * power. intervals: [{ startMs, endMs, auxKw }]. Returns [{ hourStartMs, kw }]
 * where kw is the average demand within that hour.
 */
export function hourlyShorePowerLoad(intervals) {
  const HOUR = 3_600_000;
  const buckets = new Map();
  for (const { startMs, endMs, auxKw } of intervals) {
    if (!(endMs > startMs) || !(auxKw > 0)) continue;
    let t = startMs;
    while (t < endMs) {
      const hourStart = Math.floor(t / HOUR) * HOUR;
      const next = Math.min(hourStart + HOUR, endMs);
      buckets.set(
        hourStart,
        (buckets.get(hourStart) ?? 0) + (auxKw * (next - t)) / HOUR,
      );
      t = next;
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hourStartMs, kw]) => ({ hourStartMs, kw }));
}
