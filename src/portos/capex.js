/**
 * Capital plan for zero-emission equipment purchases.
 *
 * Two methods so the old workbook can be reproduced and corrected:
 * - workbook: units x capital, minus ONE voucher per class per purchase year,
 *   no charging infrastructure. This is what the V23MFE sheet computes.
 * - per-unit: every unit gets its own voucher and its own infrastructure cost.
 */

/** @returns {{ byYear: object, byClass: object, total: number }} */
export function capexPlan(purchases, unitCosts, { method = 'per-unit' } = {}) {
  const byYear = {};
  const byClass = {};
  let total = 0;
  for (const [year, row] of Object.entries(purchases)) {
    for (const [specId, units] of Object.entries(row)) {
      const cost = unitCosts[specId];
      if (!cost || !units) continue;
      const amount =
        method === 'workbook'
          ? units * cost.capital - cost.voucher
          : units * (cost.capital - cost.voucher + cost.infrastructure);
      (byYear[year] ||= {})[specId] = amount;
      byClass[specId] = (byClass[specId] || 0) + amount;
      total += amount;
    }
  }
  return { byYear, byClass, total };
}
