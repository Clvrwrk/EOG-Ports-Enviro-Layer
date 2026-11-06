import assert from 'node:assert/strict';
import test from 'node:test';
import { portRouteHash } from './portRoute.js';
import { decodeLayerStateParams } from '../data/layerState.js';

test('a port page path becomes a share of that port with its layers on', () => {
  const hash = portRouteHash('/ports/california/port-of-hueneme');
  const params = new URLSearchParams(hash);
  assert.equal(params.get('lat'), '34.1045');
  assert.equal(params.get('lon'), '-119.2085');
  assert.equal(params.get('pitch'), '-50');
  const layers = decodeLayerStateParams(params);
  assert.ok(layers, 'layer state decodes');
  assert.deepEqual([...layers.enabledLayerIds].sort(), [
    'ais-live-vessels',
    'port-emissions',
  ]);
});

test('other paths are not port pages', () => {
  assert.equal(portRouteHash('/'), null);
  assert.equal(portRouteHash('/share/AQc'), null);
  assert.equal(portRouteHash('/ports/texas/port-of-hueneme'), null);
});
