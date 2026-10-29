import assert from 'node:assert/strict';
import test from 'node:test';

import { pendingElements, pendingFiles, rememberAppliedScene } from './editor/boardSync.js';

test('sends only elements whose version is not on the wire yet', () => {
  const sent = new Map([['a', 1]]);
  const pending = pendingElements(
    [
      { id: 'a', version: 1 },
      { id: 'a', version: 2 },
      { id: 'b', version: 1 },
    ],
    sent,
  );
  assert.deepEqual(
    pending.map((element) => element.id + element.version),
    ['a2', 'b1'],
  );
});

test('does not resend a version bumped while applying a remote packet', () => {
  const sent = new Map([
    ['a', 1],
    ['b', 1],
  ]);
  rememberAppliedScene(
    [
      { id: 'a', version: 1 },
      { id: 'b', version: 3 },
    ],
    [
      { id: 'a', version: 2 },
      { id: 'b', version: 3 },
    ],
    sent,
  );
  assert.deepEqual(
    pendingElements(
      [
        { id: 'a', version: 2 },
        { id: 'b', version: 3 },
      ],
      sent,
    ).map((element) => element.id),
    ['b'],
  );
});

test('keeps a local edit that reconcile did not overwrite', () => {
  const sent = new Map([['a', 1]]);
  rememberAppliedScene([{ id: 'a', version: 4 }], [{ id: 'a', version: 4 }], sent);
  assert.deepEqual(
    pendingElements([{ id: 'a', version: 4 }], sent).map((element) => element.id),
    ['a'],
  );
});

test('sends a file once, and again only if its payload grew', () => {
  const sent = new Map();
  assert.deepEqual(Object.keys(pendingFiles({ mouse: { dataURL: 'abc' } }, sent)), ['mouse']);
  sent.set('mouse', 3);
  assert.deepEqual(Object.keys(pendingFiles({ mouse: { dataURL: 'abc' } }, sent)), []);
  assert.deepEqual(Object.keys(pendingFiles({ mouse: { dataURL: 'abcd' } }, sent)), ['mouse']);
});
