import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fileAddressFor,
  isAbsoluteWorkspacePath,
  isWindowsStylePath,
  parseSessionFileAddress,
  sessionFileAddress,
} from '../src/address.js';

test('会话地址：编码每一段，`:` 留给盘符，反斜杠归一', () => {
  assert.equal(
    sessionFileAddress('s1', 'docs/a b.html'),
    'dsh-resource://file/session/s1/docs/a%20b.html',
  );
  assert.equal(sessionFileAddress('s1', './x/y.md'), 'dsh-resource://file/session/s1/x/y.md');
  assert.equal(sessionFileAddress('s1', 'C:/x.md'), 'dsh-resource://file/session/s1/C:/x.md');
  assert.equal(
    sessionFileAddress('s1', 'docs\\报 告.md'),
    'dsh-resource://file/session/s1/docs/%E6%8A%A5%20%E5%91%8A.md',
  );
});

test('绝对路径判定', () => {
  assert.equal(isAbsoluteWorkspacePath('/a/b'), true);
  assert.equal(isAbsoluteWorkspacePath('C:\\a\\b'), true);
  assert.equal(isAbsoluteWorkspacePath('\\\\server\\share'), true);
  assert.equal(isAbsoluteWorkspacePath('a/b'), false);
  assert.equal(isWindowsStylePath('/a/b'), false);
});

test('工作区内削成相对；工作区外**保留前导斜杠**（地址里两个斜杠）', () => {
  const cwd = '/Users/me/proj';
  assert.equal(
    fileAddressFor('s1', cwd, '/Users/me/proj/docs/x.html'),
    'dsh-resource://file/session/s1/docs/x.html',
  );
  assert.equal(
    fileAddressFor('s1', cwd, 'docs/x.html'),
    'dsh-resource://file/session/s1/docs/x.html',
  );
  // 关键语义：前导 `/` 是"绝对路径"的证据，解析回来才是 /tmp/shot.png
  assert.equal(
    fileAddressFor('s1', cwd, '/tmp/shot.png'),
    'dsh-resource://file/session/s1//tmp/shot.png',
  );
  assert.equal(fileAddressFor('s1', cwd, cwd), 'dsh-resource://file/session/s1/');
  assert.equal(
    fileAddressFor('s1', undefined, '/tmp/a.md'),
    'dsh-resource://file/session/s1//tmp/a.md',
  );
});

test('parseSessionFileAddress：与 sessionFileAddress 互为逆运算', () => {
  assert.deepEqual(parseSessionFileAddress('dsh-resource://file/session/s1/docs/x.html'), {
    sessionId: 's1',
    path: 'docs/x.html',
  });
  // 工作区外的绝对路径：地址里两个斜杠，解回来必须还是一个前导斜杠
  assert.deepEqual(parseSessionFileAddress('dsh-resource://file/session/s1//tmp/shot.png'), {
    sessionId: 's1',
    path: '/tmp/shot.png',
  });
  assert.deepEqual(parseSessionFileAddress('dsh-resource://file/session/s%201/a%20b.md'), {
    sessionId: 's 1',
    path: 'a b.md',
  });
  assert.deepEqual(parseSessionFileAddress('dsh-resource://file/session/s1/'), {
    sessionId: 's1',
    path: '',
  });
  // 编码坏掉、作用域不对、空地址：一律 null（调用方别猜）
  assert.equal(parseSessionFileAddress('dsh-resource://file/session/s1/%E0%A4%A'), null);
  assert.equal(parseSessionFileAddress('dsh-resource://file/absolute/s1/x'), null);
  assert.equal(parseSessionFileAddress('dsh-resource://file/session/'), null);
  assert.equal(parseSessionFileAddress(''), null);
});
