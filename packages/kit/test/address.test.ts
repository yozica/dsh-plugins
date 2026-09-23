import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fileAddressFor,
  isAbsoluteWorkspacePath,
  isWindowsStylePath,
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
