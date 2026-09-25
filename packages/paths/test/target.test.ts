import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openFileTarget } from '../src/target.js';

test('相对路径：先"文件所在目录"，命中就用它（并透传行号）', async () => {
  const seen: string[] = [];
  const opened: [string, number | undefined][] = [];
  const address = await openFileTarget(
    {
      sessionId: 's1',
      filePath: 'docs/readme.md',
      exists: async (path) => {
        seen.push(path);
        return path === 'docs/img/b.png';
      },
      open: (resource, line) => opened.push([resource, line]),
    },
    { path: 'img/b.png', line: 42 },
  );
  assert.deepEqual(seen, ['docs/img/b.png']);
  assert.equal(address, 'dsh-resource://file/session/s1/docs/img/b.png');
  assert.deepEqual(opened, [['dsh-resource://file/session/s1/docs/img/b.png', 42]]);
});

test('相对路径：文件目录没有就退到"工作区根"', async () => {
  const seen: string[] = [];
  let opened = '';
  await openFileTarget(
    {
      sessionId: 's1',
      filePath: 'docs/readme.md',
      exists: async (path) => {
        seen.push(path);
        return path === 'img/b.png';
      },
      open: (resource) => {
        opened = resource;
      },
    },
    { path: 'img/b.png' },
  );
  assert.deepEqual(seen, ['docs/img/b.png', 'img/b.png']);
  assert.equal(opened, 'dsh-resource://file/session/s1/img/b.png');
});

test('相对路径：两个候选都读不到时，把"文件目录"那个交给宿主报没找到', async () => {
  let opened = '';
  await openFileTarget(
    {
      sessionId: 's1',
      filePath: 'docs/readme.md',
      exists: async () => false,
      open: (resource) => {
        opened = resource;
      },
    },
    { path: 'img/missing.png' },
  );
  assert.equal(opened, 'dsh-resource://file/session/s1/docs/img/missing.png');
});

test('探测抛错不影响点击（当没找到，继续下一个候选）', async () => {
  let opened = '';
  await openFileTarget(
    {
      sessionId: 's1',
      filePath: 'docs/readme.md',
      exists: async (path) => {
        if (path === 'docs/img/b.png') throw new Error('boom');
        return true;
      },
      open: (resource) => {
        opened = resource;
      },
    },
    { path: 'img/b.png' },
  );
  assert.equal(opened, 'dsh-resource://file/session/s1/img/b.png');
});

test('绝对路径不探测：工作区外保留前导斜杠（地址里两个斜杠）', async () => {
  const opened: [string, number | undefined][] = [];
  const address = await openFileTarget(
    {
      sessionId: 's1',
      filePath: 'docs/readme.md',
      exists: async () => {
        throw new Error('绝对路径不该探测');
      },
      open: (resource, line) => opened.push([resource, line]),
    },
    { path: '/tmp/shot.png' },
  );
  assert.equal(address, 'dsh-resource://file/session/s1//tmp/shot.png');
  assert.deepEqual(opened, [['dsh-resource://file/session/s1//tmp/shot.png', undefined]]);
});

test('反斜杠路径先归一成 `/`', async () => {
  let opened = '';
  await openFileTarget(
    {
      sessionId: 's1',
      filePath: 'docs/readme.md',
      open: (resource) => {
        opened = resource;
      },
    },
    { path: 'img\\b.png' },
  );
  assert.equal(opened, 'dsh-resource://file/session/s1/docs/img/b.png');
});
