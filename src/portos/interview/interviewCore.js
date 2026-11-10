/**
 * The pure half of "Build by interview": applying an answer's changes to a
 * scenario, describing what changed, and a guided interview that runs with
 * no AI at all (used when the AI route is off, out of budget or unreachable).
 *
 * A turn, from the AI or the guided tree, is:
 *   { say, question, choices: string[], answer: 'choice'|'number'|'text'|'none',
 *     done, name, patch }
 * where `patch` holds only the scenario fields that answer set.
 */
import { CHARGING_STRATEGIES } from '../fleetSim.js';
import { DELIVERED_PROFILES } from '../delivered.js';
import { SPECS } from '../hueneme.js';
import { CALL_TYPES, normalizeScenario, planMix } from '../scenarioStore.js';
import { TARIFFS } from '../tariffs.js';

const MERGED = ['tariffAdjust', 'delivered', 'battery'];
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value);

/**
 * Scenario with a turn's patch applied. Fleet rows and the nested objects
 * merge by key; `battery: null` (or `delivered: null`) removes one. Unknown
 * fields are dropped by normalizeScenario.
 */
export function applyPatch(scenario, patch) {
  if (!object(patch)) return normalizeScenario(scenario);
  const next = { ...scenario };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'fleet' && object(value)) {
      next.fleet = { ...scenario.fleet };
      for (const [specId, mix] of Object.entries(value))
        next.fleet[specId] = object(mix)
          ? { ...scenario.fleet?.[specId], ...mix }
          : mix;
    } else if (MERGED.includes(key) && object(value) && object(scenario[key]))
      next[key] = { ...scenario[key], ...value };
    else next[key] = value;
  }
  return normalizeScenario(next);
}

const pct = (value) => `${value > 0 ? '+' : ''}${value}%`;

/** Plain-language list of how a scenario differs from another. */
export function describeChanges(before, after) {
  const out = [];
  const a = normalizeScenario(before);
  const b = normalizeScenario(after);
  if (a.year !== b.year) out.push(`Fleet plan year ${b.year}`);
  if (a.callScale !== b.callScale)
    out.push(`Ship calls at ${Math.round(b.callScale * 100)}% of 2021-23`);
  if (a.tariffId !== b.tariffId) out.push(`Rate: ${TARIFFS[b.tariffId].name}`);
  if (JSON.stringify(a.tariffAdjust) !== JSON.stringify(b.tariffAdjust)) {
    const t = b.tariffAdjust;
    out.push(
      t
        ? `Rate change: ${[
            ['energy', t.energyPct],
            ['demand', t.demandPct],
            ['customer charge', t.customerPct],
          ]
            .filter(([, value]) => value)
            .map(([label, value]) => `${label} ${pct(value)}`)
            .join(', ')}`
        : 'Rate back to published',
    );
  }
  if (a.includeDeferredDemand !== b.includeDeferredDemand)
    out.push(
      b.includeDeferredDemand
        ? 'Deferred EV demand charges billed'
        : 'Deferred EV demand charges not billed',
    );
  if (JSON.stringify(a.delivered) !== JSON.stringify(b.delivered)) {
    const d = b.delivered;
    out.push(
      d
        ? `Delivered energy: ${d.sharePct}% of load, ${DELIVERED_PROFILES[d.profile].toLowerCase()}, $${d.pricePerKwh}/kWh`
        : 'No delivered energy',
    );
  }
  for (const specId of new Set([
    ...Object.keys(a.fleet),
    ...Object.keys(b.fleet),
  ])) {
    if (JSON.stringify(a.fleet[specId]) === JSON.stringify(b.fleet[specId]))
      continue;
    const mix = b.fleet[specId];
    const label = SPECS[specId]?.label ?? specId;
    out.push(
      mix
        ? `${label}: ${mix.electric} electric, ${mix.diesel} diesel, ${mix.chargers} chargers`
        : `${label}: follows the fleet plan`,
    );
  }
  if (a.strategy !== b.strategy)
    out.push(`Charging: ${CHARGING_STRATEGIES[b.strategy].label}`);
  if (a.reserve !== b.reserve)
    out.push(`Charge back to ${Math.round(b.reserve * 100)}% before work`);
  if (
    a.shorePower !== b.shorePower ||
    JSON.stringify(a.shorePowerTypes) !== JSON.stringify(b.shorePowerTypes)
  )
    out.push(
      b.shorePower
        ? `Shore power for ${b.shorePowerTypes.join(', ')}`
        : 'No shore power',
    );
  if (a.baseLoadKw !== b.baseLoadKw)
    out.push(`Buildings and other load ${b.baseLoadKw} kW`);
  if (JSON.stringify(a.battery) !== JSON.stringify(b.battery))
    out.push(
      b.battery
        ? `Site battery ${b.battery.kwh} kWh / ${b.battery.kw} kW`
        : 'No site battery',
    );
  return out;
}

// ---- the guided interview (no AI) -----------------------------------------

const TOPICS = Object.freeze([
  ['Electricity rate change', 'rate'],
  ['Delivered energy (PPA, solar, microgrid)', 'delivered'],
  ['Electrify equipment', 'fleet'],
  ['Shore power for ships', 'shore'],
  ['Site battery', 'battery'],
  ['Change in ship calls (trade, new service)', 'calls'],
]);
const FLEET_CHOICES = Object.freeze([
  ['UTRs (yard tractors)', ['utr']],
  ['Reach stackers', ['reach_stacker']],
  ['Class V forklifts', ['forklift_class_v']],
  ['All yard equipment', ['utr', 'reach_stacker', 'forklift_class_v']],
]);

/** A number out of an answer like "+12%", "45", "$0.14/kWh". */
export function numberIn(text) {
  const match = String(text)
    .replace(/,/g, '')
    .match(/[-+]?\d*\.?\d+/);
  return match ? Number(match[0]) : null;
}

const ask = (question, choices, answer = 'choice') => ({
  question,
  choices,
  answer,
});

/** The question a guided step asks. */
function stepQuestion(step, state) {
  switch (step) {
    case 'start':
      return ask(
        'What change do you want to test?',
        TOPICS.map(([label]) => label),
      );
    case 'more':
      return ask('Add another change, or finish?', [
        'Finish',
        ...TOPICS.filter(([, id]) => !state.covered.includes(id)).map(
          ([label]) => label,
        ),
      ]);
    case 'rate.parts':
      return ask('Which part of the bill changes?', [
        'Energy rates',
        'Demand charges',
        'Both',
        'Switch to another rate',
      ]);
    case 'rate.energy':
      return ask(
        'By what percent do energy rates change? (Negative for a cut.)',
        ['+5%', '+10%', '+20%', '-10%'],
        'number',
      );
    case 'rate.demand':
      return ask(
        'By what percent do demand charges change?',
        ['+10%', '+25%', '+50%', '-25%'],
        'number',
      );
    case 'rate.switch':
      return ask(
        'Which rate?',
        Object.values(TARIFFS).map((t) => t.name),
      );
    case 'rate.deferred':
      return ask(
        'TOU-EV-9 demand charges are not billed until the CPUC turns them on. Bill them anyway, as a stress test?',
        ['Yes, bill them', 'No'],
      );
    case 'delivered.share':
      return ask(
        'What share of the port’s yearly electricity load does it cover?',
        ['25%', '45%', '60%', '100%'],
        'number',
      );
    case 'delivered.source':
      return ask('Where does it come from?', [
        'Solar',
        'Fuel cell or firm PPA (around the clock)',
        'A contract that follows our load',
        'A peak product (4-9 p.m. only)',
      ]);
    case 'delivered.price':
      return ask(
        'What does it cost delivered, per kWh?',
        ['$0.10', '$0.14', '$0.18', 'Not known yet'],
        'number',
      );
    case 'fleet.which':
      return ask(
        'Which equipment goes electric?',
        FLEET_CHOICES.map(([label]) => label),
      );
    case 'fleet.share':
      return ask(`How much of it, in ${state.year}?`, [
        'All of it',
        'Three quarters',
        'Half',
        'A quarter',
      ]);
    case 'fleet.charging':
      return ask(
        'How should the electric units charge?',
        Object.values(CHARGING_STRATEGIES).map((s) => s.label),
      );
    case 'shore.types':
      return ask('Which ships plug in at berths 1-3?', [
        'Refrigerated (reefer) ships only',
        'Reefers and Ro-Ro car carriers',
        'Every ship type',
      ]);
    case 'battery.size':
      return ask('How big a site battery?', [
        '1 MWh / 500 kW',
        '2 MWh / 1 MW',
        '4 MWh / 2 MW',
      ]);
    case 'calls.pct':
      return ask(
        'By what percent do ship calls change from the 2021-23 average?',
        ['-20%', '-10%', '+10%', '+25%'],
        'number',
      );
    default:
      return ask('', [], 'none');
  }
}

const topicOf = (answer) =>
  TOPICS.find(([label]) => label === answer)?.[1] ??
  TOPICS.find(([label, id]) =>
    String(answer).toLowerCase().includes(id),
  )?.[1] ??
  null;
const FIRST_STEP = {
  rate: 'rate.parts',
  delivered: 'delivered.share',
  fleet: 'fleet.which',
  shore: 'shore.types',
  battery: 'battery.size',
  calls: 'calls.pct',
};

/** The first guided turn. */
export function guidedStart(scenario) {
  const state = {
    step: 'start',
    covered: [],
    year: normalizeScenario(scenario).year,
    pending: [],
  };
  return {
    state,
    turn: {
      say: '',
      ...stepQuestion('start', state),
      done: false,
      name: '',
      patch: {},
    },
  };
}

/**
 * Apply an answer to a guided step and pick the next question from it.
 * @returns {{ state, turn }}
 */
export function guidedAnswer(state, answer, scenario) {
  const s = {
    ...state,
    covered: [...state.covered],
    pending: [...state.pending],
  };
  const text = String(answer ?? '').trim();
  const value = numberIn(text);
  let patch = {};
  let say = '';
  let next = 'more';
  const current = normalizeScenario(scenario);
  const step = /^(finish|that is everything|done)\b/i.test(text)
    ? 'finish'
    : state.step;
  switch (step) {
    case 'start':
    case 'more': {
      if (/finish|done|that'?s all/i.test(text)) {
        next = 'done';
        break;
      }
      const topic = topicOf(text);
      if (!topic) {
        next = state.step;
        say = 'Pick one of the options to continue.';
        break;
      }
      s.covered.push(topic);
      next = FIRST_STEP[topic];
      break;
    }
    case 'rate.parts':
      if (/switch|another/i.test(text)) next = 'rate.switch';
      else if (/both/i.test(text)) {
        next = 'rate.energy';
        s.pending.push('rate.demand');
      } else next = /demand/i.test(text) ? 'rate.demand' : 'rate.energy';
      break;
    case 'rate.energy':
    case 'rate.demand': {
      if (value == null) {
        next = state.step;
        say = 'Type a percent, like +12 or -5.';
        break;
      }
      const field = state.step === 'rate.energy' ? 'energyPct' : 'demandPct';
      patch = {
        tariffAdjust: {
          energyPct: current.tariffAdjust?.energyPct ?? 0,
          demandPct: current.tariffAdjust?.demandPct ?? 0,
          customerPct: current.tariffAdjust?.customerPct ?? 0,
          [field]: value,
        },
      };
      say = `${field === 'energyPct' ? 'Energy rates' : 'Demand charges'} ${pct(value)}.`;
      next = s.pending.shift() ?? 'more';
      break;
    }
    case 'rate.switch': {
      const tariff = Object.values(TARIFFS).find((t) => t.name === text);
      if (!tariff) {
        next = state.step;
        say = 'Pick one of the rates listed.';
        break;
      }
      patch = { tariffId: tariff.id };
      say = `Rate set to ${tariff.name}.`;
      next = tariff.demand.billed ? 'more' : 'rate.deferred';
      break;
    }
    case 'rate.deferred':
      patch = { includeDeferredDemand: /^y/i.test(text) };
      break;
    case 'delivered.share':
      if (value == null || value <= 0) {
        next = state.step;
        say = 'Type a share of load in percent, like 45.';
        break;
      }
      patch = {
        delivered: {
          sharePct: Math.min(100, value),
          profile: current.delivered?.profile ?? 'share',
          pricePerKwh: current.delivered?.pricePerKwh ?? 0,
        },
      };
      say = `Delivered energy covers ${Math.min(100, value)}% of yearly load.`;
      next = 'delivered.source';
      break;
    case 'delivered.source': {
      const profile = /solar/i.test(text)
        ? 'solar'
        : /peak/i.test(text)
          ? 'peak'
          : /follow/i.test(text)
            ? 'share'
            : 'baseload';
      patch = { delivered: { profile } };
      say =
        profile === 'solar'
          ? 'Solar arrives in daylight; anything above the load at the time is curtailed.'
          : `Supply shaped as: ${DELIVERED_PROFILES[profile].toLowerCase()}.`;
      next = 'delivered.price';
      break;
    }
    case 'delivered.price':
      patch = { delivered: { pricePerKwh: value != null ? value : 0 } };
      say =
        value != null
          ? `Priced at $${value}/kWh.`
          : 'Left unpriced for now; set the price in the builder later.';
      break;
    case 'fleet.which': {
      const pick = FLEET_CHOICES.find(([label]) => label === text);
      s.specs = pick ? pick[1] : ['utr'];
      next = 'fleet.share';
      break;
    }
    case 'fleet.share': {
      const fraction = /all/i.test(text)
        ? 1
        : /three/i.test(text)
          ? 0.75
          : /quarter/i.test(text)
            ? 0.25
            : /half/i.test(text)
              ? 0.5
              : value != null
                ? Math.min(1, value / 100)
                : 1;
      const fleet = {};
      const parts = [];
      for (const specId of s.specs ?? ['utr']) {
        const plan = planMix(current.year, specId);
        if (!plan) continue;
        const units = plan.diesel + plan.electric;
        const electric = Math.round(units * fraction);
        fleet[specId] = {
          electric,
          diesel: units - electric,
          chargers: electric,
        };
        parts.push(`${electric} of ${units} ${SPECS[specId].label}s`);
      }
      patch = { fleet };
      say = `Electric: ${parts.join(', ')}.`;
      next = 'fleet.charging';
      break;
    }
    case 'fleet.charging': {
      const strategy =
        Object.entries(CHARGING_STRATEGIES).find(
          ([, rule]) => rule.label === text,
        )?.[0] ?? 'asap';
      patch = { strategy };
      break;
    }
    case 'shore.types': {
      const types = /every/i.test(text)
        ? [...CALL_TYPES]
        : /ro-ro/i.test(text)
          ? ['Refrigerated', 'Ro-Ro/Vehicles Carrier']
          : ['Refrigerated'];
      patch = { shorePower: true, shorePowerTypes: types };
      say = `Shore power for ${types.join(', ')}.`;
      break;
    }
    case 'battery.size': {
      const [kwh, kw] = /4 MWh/.test(text)
        ? [4000, 2000]
        : /2 MWh/.test(text)
          ? [2000, 1000]
          : [1000, 500];
      patch = {
        battery: { kwh, kw, roundTripEfficiency: 0.88, thresholdKw: 'auto' },
      };
      say = `A ${kwh} kWh / ${kw} kW battery shaves the meter peak.`;
      break;
    }
    case 'calls.pct':
      if (value == null) {
        next = state.step;
        say = 'Type a percent, like +15 or -10.';
        break;
      }
      patch = { callScale: Math.round((1 + value / 100) * 100) / 100 };
      say = `Ship calls at ${Math.round((1 + value / 100) * 100)}% of the 2021-23 average.`;
      break;
    default:
      next = 'done';
  }
  if (step === 'finish') next = 'done';
  s.step = next;
  if (next === 'done') {
    const after = applyPatch(scenario, patch);
    const changes = describeChanges(normalizeScenario({}), after);
    return {
      state: s,
      turn: {
        say: changes.length
          ? `Done: ${changes.join('; ')}.`
          : 'Done. No changes from the fleet plan.',
        question: '',
        choices: [],
        answer: 'none',
        done: true,
        name: guidedName(s.covered),
        patch,
      },
    };
  }
  return {
    state: s,
    turn: {
      say,
      ...stepQuestion(next, s),
      done: false,
      name: '',
      patch,
    },
  };
}

function guidedName(covered) {
  const names = {
    rate: 'rate change',
    delivered: 'delivered energy',
    fleet: 'electrified fleet',
    shore: 'shore power',
    battery: 'battery',
    calls: 'call volume',
  };
  const words = covered.map((id) => names[id]).filter(Boolean);
  if (!words.length) return 'Interview scenario';
  const text = words.join(' + ');
  return (text[0].toUpperCase() + text.slice(1)).slice(0, 60);
}
