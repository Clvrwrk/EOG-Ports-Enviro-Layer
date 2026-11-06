/**
 * Time-of-use calendar: which rate period a local wall-clock time falls in.
 *
 * Times are local port time (Pacific for SCE) expressed as plain parts, so
 * the engine never depends on the host time zone. Daylight-saving shifts are
 * ignored: every simulated day has 96 fifteen-minute steps.
 */

/** Steps per hour and per day for the 15-minute engine. */
export const STEPS_PER_HOUR = 4;
export const STEPS_PER_DAY = 24 * STEPS_PER_HOUR;

const DAY_MS = 86_400_000;

/** Day of week for a calendar date, 0 = Sunday. */
export function dayOfWeek(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function nthWeekday(year, month, weekday, n) {
  const first = dayOfWeek(year, month, 1);
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

function lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = dayOfWeek(year, month, last);
  return last - ((lastDow - weekday + 7) % 7);
}

/**
 * SCE TOU holidays for a year as "M-D" keys. A holiday falling on Sunday is
 * observed the following Monday, as the SCE tariff rules state.
 */
export function sceHolidays(year) {
  const days = [
    [1, 1],
    [2, nthWeekday(year, 2, 1, 3)], // Presidents' Day
    [5, lastWeekday(year, 5, 1)], // Memorial Day
    [7, 4],
    [9, nthWeekday(year, 9, 1, 1)], // Labor Day
    [11, 11],
    [11, nthWeekday(year, 11, 4, 4)], // Thanksgiving
    [12, 25],
  ];
  const keys = new Set();
  for (const [month, day] of days) {
    if (dayOfWeek(year, month, day) === 0) {
      const next = new Date(Date.UTC(year, month - 1, day) + DAY_MS);
      keys.add(`${next.getUTCMonth() + 1}-${next.getUTCDate()}`);
    } else keys.add(`${month}-${day}`);
  }
  return keys;
}

/** Whether a date bills as a weekday (not a weekend or TOU holiday). */
export function isBillingWeekday(
  year,
  month,
  day,
  holidays = sceHolidays(year),
) {
  const dow = dayOfWeek(year, month, day);
  return dow !== 0 && dow !== 6 && !holidays.has(`${month}-${day}`);
}

/**
 * Rate period for a local time under a tariff's period table. Each rule is
 * { season, days: 'weekday'|'weekend'|'all', from, to, period } with hours
 * as [from, to). The first matching rule wins; anything unmatched is off-peak.
 */
export function touPeriod(tariff, { month, hour, weekday }) {
  const season = tariff.seasons.summerMonths.includes(month)
    ? 'summer'
    : 'winter';
  for (const rule of tariff.periods) {
    if (rule.season !== season) continue;
    if (rule.days === 'weekday' && !weekday) continue;
    if (rule.days === 'weekend' && weekday) continue;
    if (hour >= rule.from && hour < rule.to)
      return { season, period: rule.period };
  }
  return { season, period: 'off' };
}

/**
 * Build the step calendar for one year: one entry per 15-minute step with
 * its date parts, slot hour and billing-weekday flag.
 */
export function yearSteps(year) {
  const holidays = sceHolidays(year);
  const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
  const steps = [];
  for (let d = 0; d < days; d += 1) {
    const date = new Date(Date.UTC(year, 0, 1) + d * DAY_MS);
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const weekday = isBillingWeekday(year, month, day, holidays);
    for (let s = 0; s < STEPS_PER_DAY; s += 1) {
      steps.push({
        dayIndex: d,
        month,
        day,
        dow: date.getUTCDay(),
        hour: Math.floor(s / STEPS_PER_HOUR),
        minute: (s % STEPS_PER_HOUR) * 15,
        weekday,
      });
    }
  }
  return steps;
}
