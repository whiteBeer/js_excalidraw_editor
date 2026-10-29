import assert from 'node:assert/strict';
import test from 'node:test';

import { classify } from './server.mjs';

test('health and api.js, with and without the nginx prefix', () => {
  assert.deepEqual(classify('/'), { type: 'health' });
  assert.deepEqual(classify('/board-relay'), { type: 'health' });
  assert.deepEqual(classify('/api.js'), { type: 'api' });
  assert.deepEqual(classify('/board-relay/api.js'), { type: 'api' });
});

test('editor without a slash redirects, assets stay under the page', () => {
  assert.deepEqual(classify('/editor'), { type: 'redirect' });
  assert.deepEqual(classify('/board-relay/editor'), { type: 'redirect' });
  assert.deepEqual(classify('/editor/'), { type: 'file', rel: 'index.html' });
  assert.deepEqual(classify('/board-relay/editor/assets/index.js'), {
    type: 'file',
    rel: 'assets/index.js',
  });
});

test('paths that leave the editor directory are missing', () => {
  assert.deepEqual(classify('/editor/../server.mjs'), { type: 'missing' });
  assert.deepEqual(classify('/secret'), { type: 'missing' });
});
