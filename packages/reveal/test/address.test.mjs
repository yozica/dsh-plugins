/**
 * 只测**纯逻辑**（`lib/address.js`）：地址语法与帧的形状。
 *
 * 为什么只测这么点：这个包的另外两半必须活在真环境里 —— 服务端要 `ctx.tools` / `ctx.webServer` /
 * `ctx.fs`，客户端要跑在浏览器里。它们靠 README 里那条"装着试一次"的清单验证（真机验证记录见
 * README 的「验证」段），而不是靠假 ctx 自我安慰。
 *
 * 跑法：`npm test`（不需要 DSH 在跑，也不需要网络）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fileAddressFor,
  isAbsoluteWorkspacePath,
  isLoopback,
  revealFrame,
  sessionFileAddress,
  sseData,
} from '../lib/address.js';

test('会话文件地址：会话 id 与路径都编码，`: ` 保留给盘符', () => {
  assert.equal(sessionFileAddress('s1', 'docs/a b.html'), 'dsh-resource://file/session/s1/docs/a%20b.html');
  assert.equal(sessionFileAddress('s1', './x/y.md'), 'dsh-resource://file/session/s1/x/y.md');
  // 反斜杠归一，中文照编
  assert.equal(
    sessionFileAddress('s1', 'docs\\报 告.md'),
    'dsh-resource://file/session/s1/docs/%E6%8A%A5%20%E5%91%8A.md',
  );
  // 盘符里的 `:` 不被编成 %3A（否则 Windows 上解析不出来）
  assert.equal(sessionFileAddress('s1', 'C:/x.md'), 'dsh-resource://file/session/s1/C:/x.md');
});

test('绝对路径判定：POSIX / 盘符 / UNC 都算绝对，相对路径不算', () => {
  assert.equal(isAbsoluteWorkspacePath('/a/b'), true);
  assert.equal(isAbsoluteWorkspacePath('C:\\a\\b'), true);
  assert.equal(isAbsoluteWorkspacePath('\\\\server\\share'), true);
  assert.equal(isAbsoluteWorkspacePath('a/b'), false);
  assert.equal(isAbsoluteWorkspacePath('./a/b'), false);
});

test('工作区内的绝对路径削成相对，工作区外的保留绝对', () => {
  const cwd = '/Users/me/proj';
  assert.equal(
    fileAddressFor('s1', cwd, '/Users/me/proj/docs/x.html'),
    'dsh-resource://file/session/s1/docs/x.html',
  );
  assert.equal(fileAddressFor('s1', cwd, 'docs/x.html'), 'dsh-resource://file/session/s1/docs/x.html');
  // 工作区外：**前导 `/` 要保留**（于是地址里出现两个斜杠）。
  // 这不是笔误：文件提供方用 parseFileAddress 把段拼回来时会得到 `/tmp/shot.png` —— 一个绝对路径；
  // 少了它就会变成相对工作区的 `tmp/shot.png`，打开的是另一个文件（upstream 的 fileAddressFor 同此）。
  assert.equal(
    fileAddressFor('s1', cwd, '/tmp/shot.png'),
    'dsh-resource://file/session/s1//tmp/shot.png',
  );
  // 工作区根自己
  assert.equal(fileAddressFor('s1', cwd, cwd), 'dsh-resource://file/session/s1/');
  // cwd 未知时也是一条合法地址（同样是保留了前导斜杠的绝对路径）
  assert.equal(fileAddressFor('s1', undefined, '/tmp/a.md'), 'dsh-resource://file/session/s1//tmp/a.md');
});

test('帧：带会话与路径即可，line 只在是有限数字时带上', () => {
  const base = revealFrame({ sessionId: 's1', cwd: '/p', path: '/p/a.html' });
  assert.deepEqual(base, {
    type: 'reveal',
    address: 'dsh-resource://file/session/s1/a.html',
    path: '/p/a.html',
    line: null,
  });
  assert.equal(revealFrame({ sessionId: 's1', path: 'a.md', line: 12 }).line, 12);
  // 不是数字就当没给（不许把 NaN 推给浏览器）
  assert.equal(revealFrame({ sessionId: 's1', path: 'a.md', line: Number.NaN }).line, null);
  assert.throws(() => revealFrame({ path: 'a.md' }), /会话 id/);
  assert.throws(() => revealFrame({ sessionId: 's1', path: '   ' }), /文件路径/);
});

test('SSE 一帧的形状固定（浏览器那半靠它 parse）', () => {
  assert.equal(sseData({ type: 'reveal', address: 'x' }), 'data: {"type":"reveal","address":"x"}\n\n');
});

test('测试口只认本机地址', () => {
  assert.equal(isLoopback({ socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '::1' } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '192.168.1.9' } }), false);
  assert.equal(isLoopback({}), false);
});
