import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TWIN_PATH } from '../scenarioStore.js';
import { NAV_LINKS, breadcrumbs, currentPage, linksFor } from './siteNav.js';

const labels = (crumbs) => crumbs.map((crumb) => crumb.label);

test('pages are recognised with or without .html and a trailing slash', () => {
  assert.equal(currentPage('/'), 'globe');
  assert.equal(currentPage(TWIN_PATH), 'twin');
  assert.equal(currentPage(`${TWIN_PATH}/`), 'twin');
  assert.equal(currentPage('/scenarios'), 'scenarios');
  assert.equal(currentPage('/scenarios.html'), 'scenarios');
  assert.equal(currentPage('/admin'), 'admin');
  assert.equal(currentPage('/ev-planning'), 'ev');
  assert.equal(currentPage('/share/abc'), null);
});

test('the breadcrumb follows /[category]/[state]/[name] down to the page', () => {
  assert.deepEqual(labels(breadcrumbs('/scenarios')), [
    'Globe',
    'Ports',
    'California',
    'Port of Hueneme',
    'Scenario builder',
  ]);
  assert.deepEqual(labels(breadcrumbs('/admin')), [
    'Globe',
    'Ports',
    'California',
    'Port of Hueneme',
    'Asset admin',
  ]);
  assert.equal(labels(breadcrumbs('/ev-planning')).at(-1), 'EV Planning');
  assert.deepEqual(labels(breadcrumbs(TWIN_PATH)), [
    'Globe',
    'Ports',
    'California',
    'Port of Hueneme',
  ]);
  assert.deepEqual(labels(breadcrumbs('/')), ['Globe']);
});

test('crumbs link up the trail and the current page is not a link', () => {
  const crumbs = breadcrumbs('/scenarios');
  assert.equal(crumbs[0].href, '/');
  assert.equal(crumbs[3].href, TWIN_PATH);
  assert.equal(crumbs.at(-1).href, null);
  assert.equal(breadcrumbs(TWIN_PATH).at(-1).href, null);
});

test('every page links to every other page and none links to itself', () => {
  for (const path of ['/', TWIN_PATH, '/scenarios', '/admin', '/ev-planning']) {
    const page = currentPage(path);
    const ids = linksFor(path).map((link) => link.id);
    assert.ok(!ids.includes(page), `${path} links to itself`);
    for (const id of ['twin', 'scenarios', 'admin', 'globe', 'ev'])
      if (id !== page) assert.ok(ids.includes(id), `${path} lacks ${id}`);
    assert.ok(ids.includes('layers'), `${path} lacks the twin layers`);
  }
  assert.ok(NAV_LINKS.some((link) => link.id === 'interview'));
});

test('the scenario page, the admin page and the globe all mount the bar', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../page/scenariosPage.js'), /mountSiteNav\(/);
  assert.match(read('../admin/adminPage.js'), /mountSiteNav\(/);
  assert.match(read('../fleet/evPlanningPage.js'), /mountSiteNav\(/);
  assert.match(read('../../main.js'), /mountSiteNav\(\{ variant: 'globe' \}\)/);
});
