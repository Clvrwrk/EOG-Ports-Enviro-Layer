/**
 * Reefer plugs behind a reefer meter, and stand-in telemetry for each one.
 *
 * The port's bills stop at the meter: one kWh figure for a whole yard of
 * plugs. Until per-plug readings are wired in, each plug gets a simulated
 * record (occupied or not, cargo, set point, air temperatures, compressor
 * state, kW) that is repeatable for a given day and always adds up to the
 * meter's own load at that moment. Replace `plugTelemetry` with real
 * readings per plug id and the rest of the twin follows.
 *
 * Plug positions are laid out in rows south of the meter; they are a
 * drawing aid, not a survey.
 *
 * Pure: no Cesium, no DOM.
 */
import { STEPS_PER_DAY, STEPS_PER_HOUR } from '../touCalendar.js';

/** Outlets on one reefer rack panel ("20-gang"). */
export const PLUGS_PER_GANG = 20;
/** Container slot pitch along a row and the gap between rows, metres. */
const SLOT_PITCH = 2.7;
const ROW_PITCH = 16;
const FIRST_ROW = 14;
const M_PER_DEG_LAT = 111_320;
const DT = 1 / STEPS_PER_HOUR;

/** What a reefer carries; `share` is the mix across occupied plugs. */
export const REEFER_CARGO = Object.freeze([
  { id: 'banana', label: 'Bananas', setpointC: 13.5, share: 0.6, runKw: 5.2 },
  {
    id: 'chilled',
    label: 'Chilled produce',
    setpointC: 2,
    share: 0.25,
    runKw: 6.4,
  },
  { id: 'frozen', label: 'Frozen', setpointC: -18, share: 0.15, runKw: 8.6 },
]);
/** Fans and controller while the compressor is off. */
const IDLE_KW = 0.6;
/** Yard average per plugged-in reefer, used to guess how many are in use. */
const AVERAGE_KW = 3.6;

/** Repeatable 0-1 number from a few integers. */
export function hash01(...parts) {
  let h = 2166136261;
  for (const part of parts) {
    h ^= part | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/**
 * Rows of plugs for every reefer meter that says how many it feeds.
 * @returns {{ gangs: object[], plugs: object[] }}
 */
export function plugLayout(registry) {
  const gangs = [];
  const plugs = [];
  for (const meter of registry.meters) {
    if (meter.endUse !== 'reefer' || !(meter.plugs > 0)) continue;
    const [lat, lon] = meter.at;
    const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
    const count = Math.ceil(meter.plugs / PLUGS_PER_GANG);
    for (let g = 0; g < count; g += 1) {
      const rowLat = lat - (FIRST_ROW + g * ROW_PITCH) / M_PER_DEG_LAT;
      const gang = {
        id: `${meter.id}:g${g + 1}`,
        label: `Rack ${g + 1}`,
        meterId: meter.id,
        index: g,
        at: [rowLat, lon],
      };
      gangs.push(gang);
      const inRow = Math.min(PLUGS_PER_GANG, meter.plugs - g * PLUGS_PER_GANG);
      for (let s = 0; s < inRow; s += 1) {
        const east = (s - (PLUGS_PER_GANG - 1) / 2) * SLOT_PITCH;
        plugs.push({
          id: `${gang.id}:p${s + 1}`,
          label: `Plug ${g + 1}-${String(s + 1).padStart(2, '0')}`,
          gangId: gang.id,
          meterId: meter.id,
          index: plugs.length,
          at: [rowLat, lon + east / mPerDegLon],
        });
      }
    }
  }
  return { gangs, plugs };
}

/** A plug's un-scaled state at a step: who is plugged in and cycling. */
function rawState(plug, step, occupancy) {
  const day = Math.floor(step / STEPS_PER_DAY);
  // A box stays about four days; a new roll each stay.
  const stay = Math.floor((day + plug.index * 7) / 4);
  if (hash01(plug.index, stay, 1) >= occupancy)
    return { occupied: false, kw: 0 };
  const pick = hash01(plug.index, stay, 2);
  let cargo = REEFER_CARGO[0];
  let edge = 0;
  for (const option of REEFER_CARGO) {
    edge += option.share;
    cargo = option;
    if (pick < edge) break;
  }
  // The compressor cycles on a 45-90 minute period, warmer in the afternoon.
  const period = 3 + Math.floor(hash01(plug.index, stay, 3) * 4);
  const hour = (step % STEPS_PER_DAY) / STEPS_PER_HOUR;
  const heat = 0.5 + 0.25 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
  const phase = (step + Math.floor(hash01(plug.index, 4) * period)) % period;
  const defrost = hash01(plug.index, Math.floor(step / 24), 5) < 0.02;
  const running = !defrost && phase < Math.max(1, Math.round(period * heat));
  return {
    occupied: true,
    cargo,
    defrost,
    running,
    kw: defrost ? 2.8 : running ? cargo.runKw : IDLE_KW,
  };
}

/**
 * Telemetry for every plug on one meter at a step, scaled so the plugs add
 * up to `meterKw`.
 * @param {object[]} plugs the meter's plugs from plugLayout
 * @param {number} step step of the year
 * @param {number} meterKw the meter's load at that step
 * @returns {Map<string, object>} by plug id
 */
export function plugTelemetry(plugs, step, meterKw) {
  const occupancy = Math.min(
    0.97,
    Math.max(0.05, meterKw / (plugs.length * AVERAGE_KW)),
  );
  const raw = plugs.map((plug) => rawState(plug, step, occupancy));
  const total = raw.reduce((acc, state) => acc + state.kw, 0);
  const scale = total > 0 ? meterKw / total : 0;
  const out = new Map();
  plugs.forEach((plug, i) => {
    const state = raw[i];
    if (!state.occupied) {
      out.set(plug.id, { plug, state: 'empty', kw: 0 });
      return;
    }
    const drift = hash01(plug.index, step, 6) - 0.5;
    const supplyC =
      state.cargo.setpointC + (state.running ? -0.6 : 0.9) + drift * 0.4;
    out.set(plug.id, {
      plug,
      state: state.defrost ? 'defrost' : state.running ? 'cooling' : 'idle',
      cargo: state.cargo.label,
      setpointC: state.cargo.setpointC,
      supplyC,
      returnC: supplyC + 1.4 + drift,
      kw: state.kw * scale,
    });
  });
  return out;
}

/** One plug's kWh from midnight to `step`, given the meter's kW for the day. */
export function plugKwhToday(plugs, plugId, step, meterKwAtStep) {
  const dayStart = step - (step % STEPS_PER_DAY);
  let kwh = 0;
  for (let at = dayStart; at <= step; at += 1)
    kwh +=
      (plugTelemetry(plugs, at, meterKwAtStep(at)).get(plugId)?.kw ?? 0) * DT;
  return kwh;
}

const STATE_TEXT = {
  empty: 'No container plugged in',
  cooling: 'Compressor running',
  idle: 'Holding temperature, fans only',
  defrost: 'Defrost cycle',
};
const temp = (c) => `${c.toFixed(1)} °C`;

/** Title and rows for a clicked plug's data card. */
export function plugCard(reading, { meterLabel, kwhToday, rackKw }) {
  const { plug } = reading;
  const rows = [['State', STATE_TEXT[reading.state]]];
  if (reading.state !== 'empty')
    rows.push(
      ['Cargo', reading.cargo],
      ['Set point', temp(reading.setpointC)],
      [
        'Supply / return air',
        `${temp(reading.supplyC)} / ${temp(reading.returnC)}`,
      ],
    );
  rows.push(
    ['Power now', `${reading.kw.toFixed(1)} kW`],
    ['Energy today', `${kwhToday.toFixed(1)} kWh`],
    ['Its rack now', `${rackKw.toFixed(0)} kW across ${PLUGS_PER_GANG} plugs`],
    ['Fed from', meterLabel],
    ['Source', 'Simulated: the meter load shared across its plugs'],
  );
  return { title: `Reefer ${plug.label.toLowerCase()}`, rows };
}
