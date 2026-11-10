/**
 * Rate sheets a scenario can be billed on, and the moment that sets its
 * demand charge.
 *
 * A demand charge is priced on the single highest 15-minute average kW of
 * the month (and, on TOU-8, the highest inside the peak window on
 * weekdays). `demandDriver` finds that interval for the costliest month and
 * says what was drawing power then, so the event behind the charge can be
 * shown and jumped to.
 *
 * Pure: no Cesium, no DOM.
 */
import { TARIFFS } from './tariffs.js';
import { STEPS_PER_HOUR } from './touCalendar.js';

/** Rate sheets offered in the twin, keyed by decision value. */
export const RATE_SHEETS = Object.freeze({
  tou8: {
    label: 'TOU-8 Option D (demand charges)',
    tariffId: 'SCE-TOU-8-D',
    includeDeferredDemand: false,
  },
  ev9: {
    label: 'TOU-EV-9 (no demand charge yet)',
    tariffId: 'SCE-TOU-EV-9',
    includeDeferredDemand: false,
  },
  ev9demand: {
    label: 'TOU-EV-9 if demand charges start',
    tariffId: 'SCE-TOU-EV-9',
    includeDeferredDemand: true,
  },
  workbook: {
    label: 'Workbook averages (old)',
    tariffId: 'WORKBOOK-TOU-8-D',
    includeDeferredDemand: false,
  },
});

/** Scenario fields for a rate sheet key; unknown keys fall back to TOU-8. */
export function rateSheetInput(key) {
  const sheet = RATE_SHEETS[key] ?? RATE_SHEETS.tou8;
  return {
    tariffId: sheet.tariffId,
    includeDeferredDemand: sheet.includeDeferredDemand,
  };
}

const LOAD_LABELS = {
  shore_power: 'Shore power',
  crane: 'Crane power',
  equipment_charging: 'Equipment charging',
};

/** What was drawing grid power at a step, largest first. */
function causesAt(result, specs, step) {
  const rows = new Map();
  const add = (id, kw) => {
    if (kw > 0.5) rows.set(id, (rows.get(id) ?? 0) + kw);
  };
  for (const [specId, fleet] of Object.entries(result.fleets))
    add(
      specs[specId]?.gridTethered ? 'crane' : 'equipment_charging',
      fleet.series.gridKw[step],
    );
  if (result.shoreKw) add('shore_power', result.shoreKw[step]);
  const list = [...rows].map(([id, kw]) => ({
    id,
    label: LOAD_LABELS[id],
    kw,
  }));
  if (result.scenario.baseLoadKw > 0.5)
    list.push({
      id: 'base',
      label: 'Base load',
      kw: result.scenario.baseLoadKw,
    });
  if (result.battery) {
    const kw = result.battery.batteryKw[step];
    if (Math.abs(kw) > 0.5)
      list.push({
        id: 'battery',
        label: kw > 0 ? 'Battery discharging' : 'Battery charging',
        kw: -kw,
      });
  }
  return list.sort((a, b) => Math.abs(b.kw) - Math.abs(a.kw));
}

/**
 * @param {object} result from runScenario
 * @param {object} specs equipment specs (HUENEME_REGISTRY.specs)
 * @returns {{ billed: boolean, tariffName: string, demandCost: number,
 *   energyCost: number, share: number, months: object[], top: object|null }}
 *   `months[i]` is { month, step, kw, demandCost }; `top` adds the causes
 *   and the ship call at the costliest month's peak.
 */
export function demandDriver(result, specs) {
  const { calendar, meterKw, bills, totals } = result;
  const peaks = bills.map((bill) => ({
    month: bill.month,
    step: -1,
    kw: 0,
    demandCost: bill.demandCost,
    total: bill.total,
  }));
  for (let i = 0; i < meterKw.length; i += 1) {
    const peak = peaks[calendar[i].month - 1];
    if (meterKw[i] > peak.kw) {
      peak.kw = meterKw[i];
      peak.step = i;
    }
  }
  const billed = totals.demandCost > 0;
  const tariff = TARIFFS[result.scenario.tariffId];
  // With no demand charge the highest-load interval is still worth showing.
  const pick = [...peaks].sort((a, b) =>
    billed ? b.demandCost - a.demandCost : b.kw - a.kw,
  )[0];
  let top = null;
  if (pick && pick.step >= 0) {
    const call = result.calls.find(
      (c) => c.start <= pick.step && pick.step < c.end,
    );
    top = {
      ...pick,
      time: calendar[pick.step],
      period: result.periods[pick.step],
      causes: causesAt(result, specs, pick.step),
      call: call
        ? { id: call.id, type: call.type, berthId: call.berthId }
        : null,
      // What one more kW at that moment costs for the month.
      perKw: pick.kw > 0 ? pick.demandCost / pick.kw : 0,
      hoursAtPeak:
        meterKw.reduce(
          (acc, kw, i) =>
            acc +
            (calendar[i].month === pick.month && kw >= pick.kw * 0.9 ? 1 : 0),
          0,
        ) / STEPS_PER_HOUR,
    };
  }
  return {
    billed,
    tariffName: tariff?.name ?? result.scenario.tariffId,
    tariffStatus: tariff?.status ?? '',
    demandCost: totals.demandCost,
    energyCost: totals.energyCost,
    share: totals.electricityCost
      ? totals.demandCost / totals.electricityCost
      : 0,
    months: peaks,
    top,
  };
}
