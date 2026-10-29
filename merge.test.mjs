import assert from 'node:assert/strict';
import test from 'node:test';

import { deltaOf, mergeElements } from './merge.mjs';

const shape = (id, version, versionNonce, index = 'a0') => ({
  id,
  version,
  versionNonce,
  index,
});

test('higher version replaces the shape', () => {
  const merged = mergeElements([shape('a', 1, 1)], [shape('a', 2, 9)]);
  assert.equal(merged[0].version, 2);
});

test('lower version does not replace the shape', () => {
  const merged = mergeElements([shape('a', 5, 1)], [shape('a', 4, 0)]);
  assert.equal(merged[0].version, 5);
});

test('equal version keeps the lower versionNonce', () => {
  const merged = mergeElements([shape('a', 3, 8)], [shape('a', 3, 2)]);
  assert.equal(merged[0].versionNonce, 2);
  const back = mergeElements([shape('a', 3, 2)], [shape('a', 3, 8)]);
  assert.equal(back[0].versionNonce, 2);
});

test('shapes that exist on only one side stay', () => {
  const merged = mergeElements([shape('a', 1, 1, 'a1')], [shape('b', 1, 1, 'a0')]);
  assert.deepEqual(
    merged.map((element) => element.id),
    ['b', 'a'],
  );
});

test('a newer deletion wins', () => {
  const merged = mergeElements(
    [{ ...shape('a', 1, 1), isDeleted: false }],
    [{ ...shape('a', 2, 1), isDeleted: true }],
  );
  assert.equal(merged[0].isDeleted, true);
});

test('delta keeps only ids from the incoming message, with the stored winner', () => {
  const stored = mergeElements([shape('a', 5, 1, 'a0'), shape('b', 1, 1, 'a1')], [shape('a', 4, 0, 'a0')]);
  const delta = deltaOf(stored, [shape('a', 4, 0, 'a0')]);
  assert.deepEqual(
    delta.map((element) => element.id),
    ['a'],
  );
  assert.equal(delta[0].version, 5);
});
