import assert from 'node:assert/strict';
import { test } from 'node:test';

import { missingReact, serviceOf } from '../src/services.js';

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

test('优先走官方推荐的 ctx.get(name)（拿不到就是 undefined，不抛）', () => {
  const service = { openResource: () => {} };
  const seen: string[] = [];
  const ctx = {
    get: (name: string) => {
      seen.push(name);
      return name === 'sidebarRight' ? service : undefined;
    },
    // 故意让 reflect 抛错：证明 get 可用时压根不碰它
    reflect: {
      get: () => {
        throw new Error('不该走到 reflect');
      },
    },
  };
  assert.equal(serviceOf<typeof service>(ctx, 'sidebarRight'), service);
  assert.equal(serviceOf(ctx, 'missing'), undefined);
  assert.deepEqual(seen, ['sidebarRight', 'missing']);
});

test('ctx.get 自己抛错也只当拿不到', () => {
  const ctx = {
    get: () => {
      throw new Error('cannot get property "x" without inject');
    },
  };
  assert.equal(serviceOf(ctx, 'x'), undefined);
});

test('能力自检：宿主 react 缺导出时列出来（对齐 dshmarket 的 missingPrimitives）', () => {
  const full = {
    createElement: () => {},
    Component: function Component() {},
    useState: () => {},
    useEffect: () => {},
    useRef: () => {},
    useMemo: () => {},
  };
  assert.deepEqual(missingReact(full), []);
  const partial: Record<string, unknown> = { ...full };
  delete partial['useMemo'];
  delete partial['Component'];
  assert.deepEqual(missingReact(partial), ['Component', 'useMemo']);
  // 不是函数的（老宿主上导出可能是 undefined / 其它东西）也算缺
  assert.deepEqual(missingReact({ ...full, useRef: null }), ['useRef']);
});
