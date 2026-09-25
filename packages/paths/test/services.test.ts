import assert from 'node:assert/strict';
import { test } from 'node:test';

import { serviceOf } from '../src/services.js';

test('reflect.get(name, false) 拿得到就直接返回', () => {
  const service = { openResource: () => {} };
  const seen: [string, boolean | undefined][] = [];
  const ctx = {
    reflect: {
      get: (name: string, strict?: boolean) => {
        seen.push([name, strict]);
        return name === 'sidebarRight' ? service : undefined;
      },
    },
  };
  assert.equal(serviceOf<typeof service>(ctx, 'sidebarRight'), service);
  assert.equal(serviceOf(ctx, 'nope'), undefined);
  // 必须走非严格读取：严格模式在服务没激活时会抛
  assert.deepEqual(seen, [
    ['sidebarRight', false],
    ['nope', false],
  ]);
});

test('嵌套服务名要整体读；在 `remote` 那个面上再读属性会抛（真机红条的原因）', () => {
  const workspaceFiles = { read: async () => ({ ok: true }) };
  const remoteFace = new Proxy(
    {},
    {
      get: () => {
        throw new Error('cannot get property "remote.workspaceFiles" without inject');
      },
    },
  );
  const ctx = {
    reflect: {
      get: (name: string) => {
        if (name === 'remote.workspaceFiles') return workspaceFiles;
        if (name === 'remote') return remoteFace;
        return undefined;
      },
    },
  };
  assert.equal(serviceOf<typeof workspaceFiles>(ctx, 'remote.workspaceFiles'), workspaceFiles);
  assert.equal(serviceOf(ctx, 'remote'), remoteFace);
  assert.throws(
    () =>
      (serviceOf<{ workspaceFiles?: unknown }>(ctx, 'remote') as { workspaceFiles?: unknown })
        .workspaceFiles,
    /remote\.workspaceFiles/,
  );
});

test('代理守卫抛错（未声明的服务）时返回 undefined，不把异常漏出去', () => {
  const ctx = new Proxy(
    { reflect: { get: () => undefined } },
    {
      get: (target, prop) => {
        if (prop === 'reflect') return (target as { reflect: unknown }).reflect;
        throw new Error(`cannot get property "${String(prop)}" without inject`);
      },
    },
  );
  assert.equal(serviceOf(ctx, 'sidebarRight'), undefined);
});

test('reflect 自己抛错也只当拿不到', () => {
  const ctx = {
    reflect: {
      get: () => {
        throw new Error('boom');
      },
    },
  };
  assert.equal(serviceOf(ctx, 'sidebarRight'), undefined);
});

test('没有 reflect 的假件退回普通属性读取', () => {
  const service = { openResource: () => {} };
  const ctx = { sidebarRight: service } as unknown as Parameters<typeof serviceOf>[0];
  assert.equal(serviceOf<typeof service>(ctx, 'sidebarRight'), service);
  assert.equal(serviceOf(ctx, 'missing'), undefined);
});
