/**
 * The port's hand-drawn electrical plan: what staff have corrected on top
 * of the automatic network drawing (network.js).
 *
 * A plan holds three things:
 *  - `feedAt`: where the utility feed enters, when staff moved it;
 *  - `sources`: incoming power transformers placed on the map, each with a
 *    size chosen from TRANSFORMER_KVA;
 *  - `fedFrom`: which incoming transformer feeds each meter (meters not
 *    listed stay on the automatic feeder backbone);
 *  - `routes`: the bends of a line between its two ends, by edge id. The
 *    ends stay pinned to what the line connects, so a route survives its
 *    transformer or meter being moved.
 *
 * Nothing here is typed in by hand: positions come from clicks on the map
 * and every other value from a fixed list, so a plan can always be read
 * back by the formulas that use it.
 *
 * Pure: no Cesium, no DOM.
 */

/** Sizes an incoming transformer can be given, in kVA. */
export const TRANSFORMER_KVA = Object.freeze([
  75, 150, 300, 500, 750, 1000, 1500, 2000, 2500, 3500, 5000, 7500, 10000,
]);
export const MAX_SOURCES = 40;
export const MAX_BENDS = 60;
export const MAX_ROUTES = 2000;
const ID = /^[A-Za-z0-9][\w.:-]{0,119}$/;

export const emptyGridPlan = () => ({
  feedAt: null,
  sources: [],
  fedFrom: {},
  routes: {},
});

const isPoint = (p) =>
  Array.isArray(p) &&
  p.length === 2 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[0]) <= 90 &&
  Math.abs(p[1]) <= 180;
/** Seven decimals is about a centimetre; more is noise from the mouse. */
const round = (p) => [Number(p[0].toFixed(7)), Number(p[1].toFixed(7))];

/**
 * A clean copy of a plan, with the problems that were dropped on the way.
 * Unknown meters and transformers are removed rather than kept dangling.
 *
 * @param {unknown} raw
 * @param {{ meterIds?: string[] }} [known] when given, `fedFrom` entries for
 *   other meters are dropped
 * @returns {{ plan: object, problems: string[] }}
 */
export function normalizeGridPlan(raw, { meterIds = null } = {}) {
  const plan = emptyGridPlan();
  const problems = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { plan, problems: raw == null ? [] : ['The plan is not an object'] };
  if (raw.feedAt != null) {
    if (isPoint(raw.feedAt)) plan.feedAt = round(raw.feedAt);
    else problems.push('The utility feed position is not a map position');
  }
  const seen = new Set();
  for (const source of Array.isArray(raw.sources) ? raw.sources : []) {
    if (plan.sources.length >= MAX_SOURCES) {
      problems.push(`At most ${MAX_SOURCES} incoming transformers`);
      break;
    }
    const id = source?.id;
    if (typeof id !== 'string' || !ID.test(id) || seen.has(id)) {
      problems.push('An incoming transformer has no usable id');
      continue;
    }
    if (!isPoint(source.at)) {
      problems.push(`Transformer ${id} has no map position`);
      continue;
    }
    const kva = TRANSFORMER_KVA.includes(source.kva) ? source.kva : null;
    if (source.kva != null && kva === null)
      problems.push(`Transformer ${id}: size is not one of the listed sizes`);
    seen.add(id);
    plan.sources.push({ id, at: round(source.at), kva });
  }
  const meters = meterIds ? new Set(meterIds) : null;
  const fedFrom =
    raw.fedFrom && typeof raw.fedFrom === 'object' ? raw.fedFrom : {};
  for (const [meterId, sourceId] of Object.entries(fedFrom)) {
    if (!seen.has(sourceId)) {
      problems.push(`Meter ${meterId} points at a transformer that is gone`);
      continue;
    }
    if (meters && !meters.has(meterId)) continue;
    if (ID.test(meterId)) plan.fedFrom[meterId] = sourceId;
  }
  const routes = raw.routes && typeof raw.routes === 'object' ? raw.routes : {};
  let count = 0;
  for (const [edgeId, bends] of Object.entries(routes)) {
    if (count >= MAX_ROUTES) {
      problems.push(`At most ${MAX_ROUTES} drawn routes`);
      break;
    }
    if (!ID.test(edgeId) || !Array.isArray(bends)) {
      problems.push('A drawn route is not a list of map positions');
      continue;
    }
    if (bends.length > MAX_BENDS || !bends.every(isPoint)) {
      problems.push(`Route ${edgeId} has a bad or too long list of bends`);
      continue;
    }
    plan.routes[edgeId] = bends.map(round);
    count += 1;
  }
  return { plan, problems };
}

/** Next free transformer id ("T1", "T2", ...). */
export function nextSourceId(plan) {
  const used = new Set(plan.sources.map((s) => s.id));
  let n = 1;
  while (used.has(`T${n}`)) n += 1;
  return `T${n}`;
}

/** The name a transformer is shown under; made from its id and size. */
export function sourceLabel(source) {
  const n = /^T(\d+)$/.exec(source.id)?.[1] ?? source.id;
  return source.kva
    ? `Incoming transformer ${n} (${source.kva.toLocaleString('en-US')} kVA)`
    : `Incoming transformer ${n}`;
}

const copy = (plan) => ({
  feedAt: plan.feedAt ? [...plan.feedAt] : null,
  sources: plan.sources.map((s) => ({ ...s, at: [...s.at] })),
  fedFrom: { ...plan.fedFrom },
  routes: Object.fromEntries(
    Object.entries(plan.routes).map(([id, bends]) => [
      id,
      bends.map((p) => [...p]),
    ]),
  ),
});

/** Squared distance from p to the stretch a-b, in flat degrees. */
function stretchDistance(p, a, b) {
  const k = Math.cos((p[0] * Math.PI) / 180);
  const ax = (a[1] - p[1]) * k;
  const ay = a[0] - p[0];
  const bx = (b[1] - p[1]) * k;
  const by = b[0] - p[0];
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return (ax + dx * t) ** 2 + (ay + dy * t) ** 2;
}

/**
 * Where a new bend at `point` belongs in a line's list of bends: on the
 * stretch of the line it is nearest to.
 * @param {number[][]} path the whole line, ends included
 * @returns {number} index into the bends (path without its two ends)
 */
export function bendIndexFor(path, point) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const d = stretchDistance(point, path[i], path[i + 1]);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/**
 * Edits, each returning a new plan. `path` is the line as it is drawn now
 * (ends included), so the first edit of an automatic line starts from the
 * bends it already has.
 */
export const gridPlanEdits = {
  addBend(plan, edgeId, path, point) {
    const next = copy(plan);
    const bends = path.slice(1, -1).map((p) => [...p]);
    if (bends.length >= MAX_BENDS) return plan;
    const at = round(point);
    // A second click on the same spot adds nothing.
    if (bends.some((p) => p[0] === at[0] && p[1] === at[1])) return plan;
    bends.splice(bendIndexFor(path, point), 0, at);
    next.routes[edgeId] = bends;
    return next;
  },
  moveBend(plan, edgeId, path, index, point) {
    const next = copy(plan);
    const bends = path.slice(1, -1).map((p) => [...p]);
    if (!bends[index]) return plan;
    bends[index] = round(point);
    next.routes[edgeId] = bends;
    return next;
  },
  removeBend(plan, edgeId, path, index) {
    const next = copy(plan);
    const bends = path.slice(1, -1).map((p) => [...p]);
    if (!bends[index]) return plan;
    bends.splice(index, 1);
    next.routes[edgeId] = bends;
    return next;
  },
  /** Back to the automatic route. */
  resetRoute(plan, edgeId) {
    const next = copy(plan);
    delete next.routes[edgeId];
    return next;
  },
  moveFeed(plan, point) {
    const next = copy(plan);
    next.feedAt = round(point);
    return next;
  },
  addSource(plan, point) {
    if (plan.sources.length >= MAX_SOURCES) return plan;
    const next = copy(plan);
    next.sources.push({ id: nextSourceId(plan), at: round(point), kva: null });
    return next;
  },
  moveSource(plan, id, point) {
    const next = copy(plan);
    const source = next.sources.find((s) => s.id === id);
    if (!source) return plan;
    source.at = round(point);
    return next;
  },
  sizeSource(plan, id, kva) {
    const next = copy(plan);
    const source = next.sources.find((s) => s.id === id);
    if (!source) return plan;
    source.kva = TRANSFORMER_KVA.includes(kva) ? kva : null;
    return next;
  },
  /** Remove a transformer; its meters go back to the feeder backbone. */
  removeSource(plan, id) {
    const next = copy(plan);
    next.sources = next.sources.filter((s) => s.id !== id);
    for (const [meterId, sourceId] of Object.entries(next.fedFrom))
      if (sourceId === id) {
        delete next.fedFrom[meterId];
        delete next.routes[`service:${meterId}`];
      }
    delete next.routes[`feeder:source:${id}`];
    return next;
  },
  /** Feed a meter from a transformer, or from the backbone (null). */
  feedMeter(plan, meterId, sourceId) {
    const next = copy(plan);
    if ((next.fedFrom[meterId] ?? null) === (sourceId ?? null)) return plan;
    if (sourceId && next.sources.some((s) => s.id === sourceId))
      next.fedFrom[meterId] = sourceId;
    else delete next.fedFrom[meterId];
    // The old route ran from somewhere else.
    delete next.routes[`service:${meterId}`];
    return next;
  },
};
