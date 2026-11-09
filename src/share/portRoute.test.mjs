import assert from 'node:assert/strict';
import test from 'node:test';
import { homePortPath, portRouteHash } from './portRoute.js';
import { decodeLayerStateParams } from '../data/layerState.js';

test('a port page path becomes a share of that port with its layers on', () => {
  const hash = portRouteHash('/ports/california/port-of-hueneme');
  const params = new URLSearchParams(hash);
  assert.equal(params.get('lat'), '34.1045');
  assert.equal(params.get('lon'), '-119.2085');
  assert.equal(params.get('pitch'), '-50');
  const layers = decodeLayerStateParams(params);
  assert.ok(layers, 'layer state decodes');
  assert.deepEqual([...layers.enabledLayerIds].sort(), ['port-emissions']);
});

test('other paths are not port pages', () => {
  assert.equal(portRouteHash('/'), null);
  assert.equal(portRouteHash('/share/AQc'), null);
  assert.equal(portRouteHash('/ports/texas/port-of-hueneme'), null);
});

test('a bare / opens the home port only when a deployment names one', () => {
  const home = '/ports/california/port-of-hueneme';
  assert.equal(portRouteHash('/'), null);
  assert.equal(
    portRouteHash('/', undefined, { homePath: home }),
    portRouteHash(home),
  );
  assert.equal(
    portRouteHash('', undefined, { homePath: home }),
    portRouteHash(home),
  );
  assert.equal(
    portRouteHash('/share/AQc', undefined, { homePath: home }),
    null,
  );
});

test('the home port comes from VITE_HOME_PORT_PATH', () => {
  assert.equal(homePortPath({}), null);
  assert.equal(homePortPath({ VITE_HOME_PORT_PATH: '  ' }), null);
  assert.equal(
    homePortPath({ VITE_HOME_PORT_PATH: '/ports/california/port-of-hueneme' }),
    '/ports/california/port-of-hueneme',
  );
});
