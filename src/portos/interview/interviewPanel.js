/**
 * "Build by interview" on /scenarios: a dialog that asks one question at a
 * time, where each answer picks the next question, and builds a scenario the
 * builder, the compare table and the 3D twin can all load.
 *
 * It talks to POST /api/scenario-interview (the AI interviewer). When that
 * route is off, over its limits or unreachable, it switches to the guided
 * interview in interviewCore.js, which needs no AI and covers the same
 * changes with fixed branches. Every answer re-runs the engine so the
 * headline numbers move while the person answers.
 */
import './interview.css';
import { runScenario } from '../scenario.js';
import {
  TWIN_PATH,
  normalizeScenario,
  scenarioLink,
} from '../scenarioStore.js';
import {
  applyPatch,
  describeChanges,
  guidedAnswer,
  guidedStart,
} from './interviewCore.js';

const ENDPOINT = '/api/scenario-interview';
const MAX_HISTORY = 40;

const esc = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const money = (v) =>
  Math.abs(v) >= 1e6
    ? `$${(v / 1e6).toFixed(2)}M`
    : `$${Math.round(v / 1000).toLocaleString('en-US')}k`;
const num = (v) => Math.round(v).toLocaleString('en-US');

/** The few numbers the dialog shows as the scenario takes shape. */
function headline(scenario) {
  const t = runScenario(scenario).totals;
  return {
    spend: t.electricityCost + t.deliveredCost + t.dieselCost,
    electricity: t.electricityCost,
    delivered: t.deliveredCost,
    deliveredPct: t.siteKwh ? (t.deliveredKwh / t.siteKwh) * 100 : 0,
    peakKw: t.peakKw,
    co2: t.co2Tonnes,
  };
}

async function askAi(messages, scenario, signal) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, scenario }),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.turn) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.code = data?.code;
    throw error;
  }
  return data;
}

/**
 * @param {{ button: HTMLElement, current: () => object,
 *   apply: (scenario: object) => void }} options
 */
export function mountInterview({ button, current, apply }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'interview';
  dialog.setAttribute('aria-labelledby', 'ivTitle');
  dialog.innerHTML = `
    <form method="dialog" class="iv-head">
      <div>
        <h2 id="ivTitle">Build a scenario by interview</h2>
        <p class="sub" id="ivMode"></p>
      </div>
      <button value="close" aria-label="Close">Close</button>
    </form>
    <div class="iv-body">
      <div class="iv-chat" id="ivChat" aria-live="polite"></div>
      <aside class="iv-side">
        <h3>Scenario so far</h3>
        <ul id="ivChanges"></ul>
        <h3>Impact vs. where you started</h3>
        <dl id="ivImpact"></dl>
      </aside>
    </div>
    <div class="iv-answer">
      <div class="iv-choices" id="ivChoices"></div>
      <form class="iv-type" id="ivType" autocomplete="off">
        <input type="text" id="ivInput" maxlength="600" placeholder="Type an answer" aria-label="Your answer" />
        <button type="submit" class="primary">Send</button>
      </form>
      <div class="iv-actions">
        <button type="button" id="ivRestart">Start over</button>
        <button type="button" id="ivFinish">Finish now</button>
        <button type="button" id="ivApply" class="primary" hidden>Load into the builder</button>
        <a class="button" id="ivTwin" hidden>Run on the 3D port</a>
      </div>
    </div>`;
  (button.closest('.portos') ?? document.body).append(dialog);
  const $ = (id) => dialog.querySelector(`#${id}`);

  let start;
  let scenario;
  let startNumbers;
  let messages;
  let guided = null;
  let busy = false;
  let finished = false;
  let controller = null;

  const setText = (el, text) => {
    el.textContent = text;
  };

  function bubble(role, text) {
    if (!text) return;
    const div = document.createElement('div');
    div.className = `iv-msg ${role}`;
    setText(div, text);
    $('ivChat').append(div);
    $('ivChat').scrollTop = $('ivChat').scrollHeight;
  }

  function renderSide() {
    const changes = describeChanges(start, scenario);
    $('ivChanges').innerHTML = changes.length
      ? changes.map((line) => `<li>${esc(line)}</li>`).join('')
      : '<li class="muted">No changes yet</li>';
    const now = headline(scenario);
    const row = (label, before, after, format, lowerIsBetter = true) => {
      const delta = after - before;
      const tone =
        Math.abs(delta) < 0.5
          ? ''
          : delta < 0 === lowerIsBetter
            ? 'good'
            : 'bad';
      return `<dt>${label}</dt><dd>${format(after)}${Math.abs(delta) < 0.5 ? '' : ` <small class="${tone}">${delta > 0 ? '+' : '−'}${format(Math.abs(delta))}</small>`}</dd>`;
    };
    $('ivImpact').innerHTML = [
      row('Energy spend / yr', startNumbers.spend, now.spend, money),
      row(
        'Electricity bill / yr',
        startNumbers.electricity,
        now.electricity,
        money,
      ),
      now.delivered || startNumbers.delivered
        ? row(
            'Delivered energy / yr',
            startNumbers.delivered,
            now.delivered,
            money,
          )
        : '',
      now.deliveredPct || startNumbers.deliveredPct
        ? row(
            'Load met by delivered energy',
            startNumbers.deliveredPct,
            now.deliveredPct,
            (v) => `${num(v)}%`,
            false,
          ) +
          (scenario.delivered &&
          now.deliveredPct < scenario.delivered.sharePct - 1
            ? `<dd class="iv-warn">Short of the ${num(scenario.delivered.sharePct)}% target: this supply arrives when the port needs less, and the excess is curtailed.</dd>`
            : '')
        : '',
      row('Meter peak', startNumbers.peakKw, now.peakKw, (v) => `${num(v)} kW`),
      row(
        'Equipment CO2 / yr',
        startNumbers.co2,
        now.co2,
        (v) => `${num(v)} t`,
      ),
    ].join('');
  }

  function showTurn(turn) {
    if (turn.patch && Object.keys(turn.patch).length) {
      scenario = applyPatch(scenario, turn.patch);
      renderSide();
    }
    if (turn.name) scenario = { ...scenario, name: turn.name };
    bubble('ai', [turn.say, turn.question].filter(Boolean).join('\n\n'));
    finished = turn.done;
    const choices = turn.done ? [] : turn.choices;
    $('ivChoices').innerHTML = choices
      .map(
        (choice, i) =>
          `<button type="button" data-choice="${i}">${esc(choice)}</button>`,
      )
      .join('');
    $('ivChoices').choices = choices;
    $('ivType').hidden = turn.done;
    $('ivFinish').hidden = turn.done;
    $('ivApply').hidden = !turn.done;
    $('ivTwin').hidden = !turn.done;
    if (turn.done) {
      scenario = normalizeScenario(scenario);
      $('ivTwin').href = scenarioLink(scenario, TWIN_PATH);
      $('ivApply').focus();
    } else if (turn.answer !== 'choice' || !choices.length)
      $('ivInput').focus();
  }

  function setMode(isGuided) {
    setText(
      $('ivMode'),
      isGuided
        ? 'Guided mode: fixed questions, no AI. The AI interviewer is not available on this server right now.'
        : 'Each answer decides the next question. Small change or big one, it asks only what the model needs.',
    );
  }

  function switchToGuided() {
    guided = guidedStart(scenario);
    setMode(true);
    showTurn(guided.turn);
  }

  async function answer(text) {
    if (busy || finished || !text.trim()) return;
    bubble('me', text);
    $('ivInput').value = '';
    if (guided) {
      guided = guidedAnswer(guided.state, text, scenario);
      showTurn(guided.turn);
      return;
    }
    messages.push({ role: 'user', content: text.slice(0, 600) });
    await askNext();
  }

  async function askNext() {
    busy = true;
    dialog.classList.add('busy');
    controller = new AbortController();
    try {
      const data = await askAi(
        messages.slice(-MAX_HISTORY),
        scenario,
        controller.signal,
      );
      messages.push({ role: 'assistant', content: data.raw });
      showTurn(data.turn);
    } catch (error) {
      if (error.name === 'AbortError') return;
      bubble(
        'note',
        error.code === 'DAILY_LIMIT' || error.code === 'RATE_LIMITED'
          ? 'The AI interviewer is at its limit for now, so the rest uses guided questions.'
          : 'The AI interviewer could not be reached, so this continues with guided questions.',
      );
      switchToGuided();
    } finally {
      busy = false;
      dialog.classList.remove('busy');
    }
  }

  function begin() {
    controller?.abort();
    start = normalizeScenario(current());
    scenario = { ...start };
    startNumbers = headline(start);
    messages = [];
    guided = null;
    finished = false;
    $('ivChat').replaceChildren();
    setMode(false);
    renderSide();
    $('ivChoices').replaceChildren();
    $('ivApply').hidden = true;
    $('ivTwin').hidden = true;
    $('ivFinish').hidden = false;
    $('ivType').hidden = false;
    void askNext();
  }

  button.addEventListener('click', () => {
    dialog.showModal();
    begin();
  });
  dialog.addEventListener('close', () => controller?.abort());
  $('ivChoices').addEventListener('click', (event) => {
    const index = event.target.dataset?.choice;
    if (index == null) return;
    void answer($('ivChoices').choices[Number(index)]);
  });
  $('ivType').addEventListener('submit', (event) => {
    event.preventDefault();
    void answer($('ivInput').value);
  });
  $('ivRestart').addEventListener('click', begin);
  $('ivFinish').addEventListener('click', () =>
    answer('That is everything. Please finish the scenario now.'),
  );
  $('ivApply').addEventListener('click', () => {
    apply(normalizeScenario(scenario));
    dialog.close();
  });
}
