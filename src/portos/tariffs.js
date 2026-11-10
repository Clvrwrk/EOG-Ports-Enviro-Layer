/**
 * Electricity tariffs as data. Billing code (billing.js) reads only this
 * shape, so replacing a seed with the current SCE tariff book (or an OpenEI
 * URDB import) is a data change, not a code change.
 *
 * Every number here carries a `source` and `status`. None of them is a
 * current, confirmed SCE rate yet: they are planning seeds.
 */

/**
 * SCE TOU periods shared by TOU-8 and TOU-EV-9 (4-9 p.m. peak structure).
 * Summer is June-September. The winter super-off-peak start hour (8 a.m.)
 * still needs confirming against the tariff book.
 */
export const SCE_TOU_PERIODS = Object.freeze([
  { season: 'summer', days: 'weekday', from: 16, to: 21, period: 'on' },
  { season: 'summer', days: 'weekend', from: 16, to: 21, period: 'mid' },
  { season: 'winter', days: 'all', from: 16, to: 21, period: 'mid' },
  { season: 'winter', days: 'all', from: 8, to: 16, period: 'super_off' },
]);

const SCE_SEASONS = Object.freeze({ summerMonths: [6, 7, 8, 9] });

/** Time-related demand windows on SCE TOU-8: non-holiday weekdays only. */
const SCE_TRD_WINDOWS = Object.freeze([
  { season: 'summer', period: 'on' },
  { season: 'winter', period: 'mid' },
]);

const tou8OptionD = {
  facilitiesPerKw: 20.73,
  timeRelated: [
    { ...SCE_TRD_WINDOWS[0], perKw: 25.68 },
    { ...SCE_TRD_WINDOWS[1], perKw: 9.99 },
  ],
};

export const TARIFFS = Object.freeze({
  'SCE-TOU-8-D': {
    id: 'SCE-TOU-8-D',
    name: 'SCE TOU-8 Option D (2-50 kV)',
    utility: 'SCE',
    status: 'planning seed: confirm against the current SCE tariff book',
    source:
      'SCE 2025 GRC Phase 2 rate design exhibit (CPUC A.24-03-019), TOU-8 Option D block',
    seasons: SCE_SEASONS,
    periods: SCE_TOU_PERIODS,
    energy: {
      summer: { on: 0.18263, mid: 0.15865, off: 0.13848 },
      winter: { mid: 0.15479, off: 0.14966, super_off: 0.10663 },
    },
    customerChargePerMonth: 1641,
    demand: { billed: true, ...tou8OptionD },
  },
  'SCE-TOU-EV-9': {
    id: 'SCE-TOU-EV-9',
    name: 'SCE TOU-EV-9 (EV charging over 500 kW)',
    utility: 'SCE',
    status:
      'energy from the POH workbook averages (old); demand charges not billed until the CPUC authorizes them',
    source:
      'POH Utilization Model V23MFE Tariff_Table; SCE TOU-EV-8/9 fact sheet (Aug 2026)',
    seasons: SCE_SEASONS,
    periods: SCE_TOU_PERIODS,
    energy: {
      summer: { on: 0.53569, mid: 0.29561, off: 0.12918 },
      winter: { mid: 0.29561, off: 0.12918, super_off: 0.12918 },
    },
    customerChargePerMonth: 0,
    // Kept so a scenario can test what happens if the CPUC turns these on.
    demand: { billed: false, deferred: tou8OptionD },
  },
  'WORKBOOK-TOU-8-D': {
    id: 'WORKBOOK-TOU-8-D',
    name: 'TOU-8-D (workbook averages)',
    utility: 'SCE',
    status: 'old workbook averages, kept to reproduce workbook totals',
    source: 'POH Utilization Model V23MFE Tariff_Table',
    seasons: SCE_SEASONS,
    periods: SCE_TOU_PERIODS,
    energy: {
      summer: { on: 0.13221, mid: 0.12234, off: 0.09097 },
      winter: { mid: 0.12234, off: 0.09097, super_off: 0.09097 },
    },
    customerChargePerMonth: 0,
    demand: { billed: true, facilitiesPerKw: 3.22, timeRelated: [] },
  },
});

/** Energy rate for a season and period, falling back to off-peak. */
export function energyRate(tariff, season, period) {
  const table = tariff.energy[season];
  return table[period] ?? table.off;
}

const scaleBy = (pct) => 1 + (Number(pct) || 0) / 100;

/**
 * A tariff with its charges moved by a percentage: a rate case, a new rate
 * schedule priced off the current one, or a "what if demand charges double".
 * `energyPct`, `demandPct` and `customerPct` are percent changes (+10 = 10%
 * higher). Returns the tariff itself when nothing changes.
 */
export function adjustTariff(tariff, adjust) {
  if (!adjust) return tariff;
  const energy = scaleBy(adjust.energyPct);
  const demand = scaleBy(adjust.demandPct);
  const customer = scaleBy(adjust.customerPct);
  if (energy === 1 && demand === 1 && customer === 1) return tariff;
  const scaleTable = (table) =>
    Object.fromEntries(
      Object.entries(table).map(([season, rates]) => [
        season,
        Object.fromEntries(
          Object.entries(rates).map(([period, rate]) => [
            period,
            rate * energy,
          ]),
        ),
      ]),
    );
  const scaleDemand = (block) =>
    block && {
      ...block,
      ...(block.facilitiesPerKw != null
        ? { facilitiesPerKw: block.facilitiesPerKw * demand }
        : {}),
      timeRelated: (block.timeRelated || []).map((window) => ({
        ...window,
        perKw: window.perKw * demand,
      })),
      ...(block.deferred ? { deferred: scaleDemand(block.deferred) } : {}),
    };
  const parts = [];
  for (const [label, pct] of [
    ['energy', adjust.energyPct],
    ['demand', adjust.demandPct],
    ['customer charge', adjust.customerPct],
  ])
    if (Number(pct)) parts.push(`${label} ${pct > 0 ? '+' : ''}${pct}%`);
  return {
    ...tariff,
    name: `${tariff.name}, adjusted (${parts.join(', ')})`,
    energy: scaleTable(tariff.energy),
    customerChargePerMonth: tariff.customerChargePerMonth * customer,
    demand: scaleDemand(tariff.demand),
  };
}
