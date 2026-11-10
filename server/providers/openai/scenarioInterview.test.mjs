import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import {
  INTERVIEW_TURN_SCHEMA,
  createScenarioInterviewHandler,
  interviewInstructions,
  makeDailyCap,
  parseTurn,
} from './scenarioInterview.js';
import { normalizeScenario } from '../../../src/portos/scenarioStore.js';

const turn = (overrides = {}) =>
  JSON.stringify({
    say: 'Energy rates up 12%.',
    question: 'Do demand charges change too?',
    choices: ['No', '+10%'],
    answer: 'choice',
    done: false,
    name: 'Rate case',
    patch: '{"tariffAdjust":{"energyPct":12}}',
    ...overrides,
  });

async function fixture(t, overrides = {}) {
  const calls = [];
  const handler = createScenarioInterviewHandler({
    resolveApiKey: () => 'fixture-only',
    resolveRateLimit: () => '0',
    resolveHost: () => '',
    resolveAllowedHosts: () => '',
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return Response.json({
        choices: [{ message: { role: 'assistant', content: turn() } }],
        usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
      });
    },
    ...overrides,
  });
  const server = http.createServer((req, res) => void handler(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    calls,
    origin,
    send: (input) =>
      fetch(origin, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  };
}

test('interview route asks for a strict JSON turn and returns it parsed', async (t) => {
  const f = await fixture(t);
  const response = await f.send({
    messages: [{ role: 'user', content: 'A new SCE tariff' }],
    scenario: { tariffId: 'SCE-TOU-EV-9', junk: true },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.turn.patch, { tariffAdjust: { energyPct: 12 } });
  assert.equal(body.turn.question, 'Do demand charges change too?');
  assert.equal(typeof body.raw, 'string');
  assert.equal(body.usage.totalTokens, 12);
  const sent = f.calls[0].body;
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.deepEqual(
    sent.response_format.json_schema.schema,
    INTERVIEW_TURN_SCHEMA,
  );
  assert.equal(sent.max_completion_tokens, 700);
  assert.equal(sent.messages[0].role, 'system');
  assert.match(sent.messages[0].content, /"tariffId":"SCE-TOU-EV-9"/);
  assert.doesNotMatch(sent.messages[0].content, /junk/);
  assert.equal(sent.messages.at(-1).content, 'A new SCE tariff');
});

test('an empty conversation starts the interview', async (t) => {
  const f = await fixture(t);
  const response = await f.send({ messages: [], scenario: {} });
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].body.messages[1].content, 'Start the interview.');
});

test('interview route refuses other shapes before spending', async (t) => {
  const f = await fixture(t);
  for (const input of [
    { messages: [{ role: 'system', content: 'x' }] },
    { messages: [{ role: 'user', content: 'x'.repeat(4001) }] },
    { messages: [], scenario: {}, model: 'gpt-5' },
    { messages: new Array(41).fill({ role: 'user', content: 'x' }) },
  ]) {
    const response = await f.send(input);
    assert.equal(response.status, 400);
  }
  assert.equal(f.calls.length, 0);
});

test('a reply that is not a turn is a 502', async (t) => {
  const f = await fixture(t, {
    fetchImpl: async () =>
      Response.json({
        choices: [{ message: { role: 'assistant', content: 'hello' } }],
      }),
  });
  const response = await f.send({ messages: [], scenario: {} });
  assert.equal(response.status, 502);
});

test('the daily cap answers 429 without calling OpenAI', async (t) => {
  const f = await fixture(t, { resolveDailyMax: () => '1' });
  assert.equal((await f.send({ messages: [], scenario: {} })).status, 200);
  const second = await f.send({ messages: [], scenario: {} });
  assert.equal(second.status, 429);
  assert.equal((await second.json()).code, 'DAILY_LIMIT');
  assert.equal(f.calls.length, 1);
});

test('refused requests do not spend the daily cap', async (t) => {
  const f = await fixture(t, { resolveDailyMax: () => '1' });
  const bad = await f.send({ messages: [{ role: 'system', content: 'x' }] });
  assert.equal(bad.status, 400);
  const response = await fetch(`http://127.0.0.1:${new URL(f.origin).port}`, {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages: [], scenario: {} }),
  });
  assert.equal(response.status, 403);
  assert.equal((await f.send({ messages: [], scenario: {} })).status, 200);
  assert.equal(f.calls.length, 1);
});

test('makeDailyCap resets on a new UTC day', () => {
  let now = Date.UTC(2026, 10, 10, 23, 59);
  const allow = makeDailyCap(2, () => now);
  assert.equal(allow(), true);
  assert.equal(allow(), true);
  assert.equal(allow(), false);
  now = Date.UTC(2026, 10, 11, 0, 1);
  assert.equal(allow(), true);
  assert.equal(makeDailyCap(0), null);
});

test('parseTurn trims and tolerates a bad patch', () => {
  const parsed = parseTurn(
    turn({ patch: 'not json', choices: new Array(9).fill('a') }),
  );
  assert.deepEqual(parsed.patch, {});
  assert.equal(parsed.choices.length, 6);
  assert.equal(parseTurn(turn({ question: '', done: false })), null);
  assert.equal(parseTurn(turn({ answer: 'maybe' })), null);
  assert.ok(parseTurn(turn({ question: '', done: true })));
});

test('instructions name every field the browser accepts', () => {
  const text = interviewInstructions(normalizeScenario({}));
  for (const field of Object.keys(normalizeScenario({})))
    if (!['seed', 'capexMethod', 'chargerEfficiency'].includes(field))
      assert.match(text, new RegExp(`\\b${field}\\b`), field);
  assert.match(text, /45% of port load/);
});
