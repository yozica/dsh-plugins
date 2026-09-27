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
      resolve: async (path) => {
        seen.push(path);
        return path === 'docs/img/b.png' ? '/ws/docs/img/b.png' : undefined;
      },
      open: (resource, line) => opened.push([resource, line]),
    },
    { path: 'img/b.png', line: 42 },
  );
  assert.deepEqual(seen, ['docs/img/b.png']);
  // 地址里用的是宿主解析出的**绝对路径**（不经工作区根剥前缀，见 `openFileTarget` 的注释）
  assert.equal(address, 'dsh-resource://file/session/s1//ws/docs/img/b.png');
  assert.deepEqual(opened, [['dsh-resource://file/session/s1//ws/docs/img/b.png', 42]]);
});

test('相对路径：文件目录没有就退到"工作区根"', async () => {
  const seen: string[] = [];
  let opened = '';
  await openFileTarget(
    {
      sessionId: 's1',
      filePath: 'docs/readme.md',
      resolve: async (path) => {
        seen.push(path);
        return path === 'img/b.png' ? '/ws/img/b.png' : undefined;
      },
      open: (resource) => {
        opened = resource;
      },
    },
    { path: 'img/b.png' },
  );
  assert.deepEqual(seen, ['docs/img/b.png', 'img/b.png']);
  assert.equal(opened, 'dsh-resource://file/session/s1//ws/img/b.png');
});

/**
 * 这一格就是真机上漏掉的：`packages/panel-body/README.md` 里的 `../../docs/panel-path-links.md`。
 * 相对路径经 `..` **越过工作区根**时，只有宿主解析得对；以前用 `read` 探测两个候选都返回假，
 * 于是退回第一条候选、拿拼错的相对路径去造地址（地址里留下 `packages/panel-body/docs/…`）。
 */
test('相对路径越过工作区根：用宿主解析出的绝对路径，不再拿拼错的相对路径', async () => {
  const seen: string[] = [];
  let opened = '';
  await openFileTarget(
    {
      sessionId: 's1',
      filePath: 'dsh-plugins/packages/panel-body/README.md',
      resolve: async (path) => {
        seen.push(path);
        // 工作区根是 `/ws`：第一个候选解析到工作区**外**的绝对路径
        return path === 'dsh-plugins/docs/panel-path-links.md'
          ? '/ws/dsh-plugins/docs/panel-path-links.md'
          : undefined;
      },
      open: (resource) => {
        opened = resource;
      },
    },
    { path: '../../docs/panel-path-links.md' },
  );
  assert.deepEqual(seen, ['dsh-plugins/docs/panel-path-links.md']);
  assert.equal(opened, 'dsh-resource://file/session/s1//ws/dsh-plugins/docs/panel-path-links.md');
});

test('相对路径：两个候选都解析不到时，把"文件目录"那个交给宿主报没找到', async () => {
  let opened = '';
  await openFileTarget(
    {
      sessionId: 's1',
      filePath: 'docs/readme.md',
      resolve: async () => undefined,
      open: (resource) => {
        opened = resource;
      },
    },
    { path: 'img/missing.png' },
  );
  assert.equal(opened, 'dsh-resource://file/session/s1/docs/img/missing.png');
});

test('解析抛错不影响点击（当没找到，继续下一个候选）', async () => {
  let opened = '';
  await openFileTarget(
    {
      sessionId: 's1',
      filePath: 'docs/readme.md',
      resolve: async (path) => {
        if (path === 'docs/img/b.png') throw new Error('boom');
        return '/ws/img/b.png';
      },
      open: (resource) => {
        opened = resource;
      },
    },
    { path: 'img/b.png' },
  );
  assert.equal(opened, 'dsh-resource://file/session/s1//ws/img/b.png');
});

test('绝对路径不探测：工作区外保留前导斜杠（地址里两个斜杠）', async () => {
  const opened: [string, number | undefined][] = [];
  const address = await openFileTarget(
    {
      sessionId: 's1',
      filePath: 'docs/readme.md',
      resolve: async () => {
        throw new Error('绝对路径不该解析');
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
