/**
 * Vessel-call schedule and the equipment demand it creates.
 *
 * A call is { id, type, berthId, start, end, template, finishTemplate? }
 * with start/end as 15-minute step indexes into the simulated year. The
 * same shape is what the live event log records from AIS, so a recorded
 * year can replace the synthetic one without touching the engine.
 */
import { STEPS_PER_DAY, STEPS_PER_HOUR } from './touCalendar.js';

/** Small deterministic PRNG (mulberry32) so a seed reproduces a schedule. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a synthetic year of calls from a call profile. Arrivals are
 * spread across the year at random; a call waits for a free berth from its
 * type's list and, when the type sets `maxConcurrent`, for a free crew (a
 * port with three harbor cranes cannot work two 2-gang calls at once).
 * `scale` multiplies every type's annual call count.
 */
export function synthesizeCalls(
  profile,
  { days = 365, seed = 1, scale = 1 } = {},
) {
  const random = seededRandom(seed);
  const totalSteps = days * STEPS_PER_DAY;
  const requests = [];
  for (const row of profile) {
    const count = Math.round(row.callsPerYear * scale * (days / 365));
    for (let i = 0; i < count; i += 1) {
      const hours = row.meanHours * (0.5 + random());
      requests.push({
        row,
        arrival: Math.floor(random() * totalSteps),
        steps: Math.max(1, Math.round(hours * STEPS_PER_HOUR)),
      });
    }
  }
  requests.sort((a, b) => a.arrival - b.arrival);
  const freeAt = new Map();
  const typeEnds = new Map();
  const calls = [];
  for (const [index, request] of requests.entries()) {
    const { row } = request;
    let crewReady = request.arrival;
    if (row.maxConcurrent) {
      const busy = (typeEnds.get(row.type) || [])
        .filter((end) => end > crewReady)
        .sort((a, b) => a - b);
      if (busy.length >= row.maxConcurrent)
        crewReady = busy[busy.length - row.maxConcurrent];
    }
    let berthId = row.berths[0];
    let start = Infinity;
    for (const candidate of row.berths) {
      const ready = Math.max(crewReady, freeAt.get(candidate) ?? 0);
      if (ready < start) {
        start = ready;
        berthId = candidate;
      }
    }
    const end = Math.min(totalSteps, start + request.steps);
    if (start >= totalSteps) continue;
    freeAt.set(berthId, end);
    if (!typeEnds.has(row.type)) typeEnds.set(row.type, []);
    typeEnds.get(row.type).push(end);
    calls.push({
      id: `call-${String(index + 1).padStart(4, '0')}`,
      type: row.type,
      cargo: row.cargo,
      berthId,
      start,
      end,
      template: row.template,
      ...(row.finishTemplate ? { finishTemplate: row.finishTemplate } : {}),
    });
  }
  return calls;
}

/** Hours of main-shift work before a call with a finish template switches. */
const MAIN_SHIFT_WORK_STEPS = 8 * STEPS_PER_HOUR;

/**
 * Turn calls into units-at-work per spec per step. Work happens only in
 * NS/DS slots; HOOT and BREAK slots leave equipment idle.
 */
export function equipmentDemand(calls, { totalSteps, slots, templates }) {
  const demand = {};
  const series = (specId) => (demand[specId] ||= new Uint16Array(totalSteps));
  for (const call of calls) {
    let worked = 0;
    for (
      let step = call.start;
      step < call.end && step < totalSteps;
      step += 1
    ) {
      const slot = slots[Math.floor((step % STEPS_PER_DAY) / STEPS_PER_HOUR)];
      if (slot !== 'NS' && slot !== 'DS') continue;
      const name =
        call.finishTemplate && worked >= MAIN_SHIFT_WORK_STEPS
          ? call.finishTemplate
          : call.template;
      worked += 1;
      for (const [specId, units] of Object.entries(templates[name] || {}))
        series(specId)[step] += units;
    }
  }
  return demand;
}

/** Shore-power draw per step (kW) for calls at berths with shore power. */
export function shorePowerLoad(calls, { totalSteps, vaults, types }) {
  const load = new Float64Array(totalSteps);
  const kwByBerth = new Map(vaults.map((vault) => [vault.berthId, vault.kw]));
  for (const call of calls) {
    if (!types.includes(call.type)) continue;
    const kw = kwByBerth.get(call.berthId);
    if (!kw) continue;
    for (let step = call.start; step < call.end && step < totalSteps; step += 1)
      load[step] += kw;
  }
  return load;
}
