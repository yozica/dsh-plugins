import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseRevealFrame } from '../src/browser.js';
import { revealFrame } from '../src/server/frames.js';

test('revealFrame：地址由服务端算好，line 只在是有限数字时带上', () => {
  assert.deepEqual(revealFrame({ sessionId: 's1', cwd: '/p', path: '/p/a.html' }), {
    type: 'reveal',
    address: 'dsh-resource://file/session/s1/a.html',
    path: '/p/a.html',
    line: null,
  });
  assert.equal(revealFrame({ sessionId: 's1', path: 'a.md', line: 12 }).line, 12);
  assert.equal(revealFrame({ sessionId: 's1', path: 'a.md', line: Number.NaN }).line, null);
  assert.throws(() => revealFrame({ sessionId: '', path: 'a.md' }), /会话 id/);
  assert.throws(() => revealFrame({ sessionId: 's1', path: '  ' }), /文件路径/);
});

test('parseRevealFrame：坏帧一律 null（浏览器那半不因为坏数据出错）', () => {
  assert.equal(parseRevealFrame(null), null);
  assert.equal(parseRevealFrame({ type: 'other', address: 'x' }), null);
  assert.equal(parseRevealFrame({ type: 'reveal' }), null);
  assert.deepEqual(
    parseRevealFrame({ type: 'reveal', address: 'dsh-resource://file/session/s1/a', line: 'x' }),
    {
      type: 'reveal',
      address: 'dsh-resource://file/session/s1/a',
      path: '',
      line: null,
    },
  );
});
