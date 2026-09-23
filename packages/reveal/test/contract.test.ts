import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apply, inject, name } from '../src/index.js';
import { EVENTS_ENDPOINT, PUSH_ENDPOINT } from '../src/shared/endpoints.js';
import type { ServerContext, ServerRequest, ServerResponse } from '@yozica/dsh-plugin-kit';

/** 契约测试：用假 ctx 断言"这个插件到底注册了什么" —— 不需要真起 dsh */
function fakeContext() {
  const tools: { name: string; parameters: unknown; description: string }[] = [];
  const routes = new Map<string, (req: ServerRequest, res: ServerResponse) => void>();
  const effects: (() => void)[] = [];
  const warnings: unknown[][] = [];
  const ctx: ServerContext = {
    tools: { register: (definition) => tools.push(definition as never) },
    webServer: {
      register: (route) => (routes.set(route.path, route.handler), () => routes.delete(route.path)),
    },
    fs: { lstat: async () => ({ type: 'file' }) },
    logger: { warn: (...args: unknown[]) => warnings.push(args) },
    effect: (body) => {
      const dispose = body();
      if (typeof dispose === 'function') effects.push(dispose);
    },
  };
  return { ctx, tools, routes, effects, warnings };
}

test('契约：注册名为 reveal 的工具、挂两条路由、并在 effect 里收尾', () => {
  const { ctx, tools, routes, effects } = fakeContext();
  assert.deepEqual(inject, ['tools', 'webServer', 'fs']);
  assert.equal(name, 'plugin-reveal');
  apply(ctx);

  assert.equal(tools.length, 1);
  assert.equal(tools[0]!.name, 'reveal');
  assert.match(tools[0]!.description, /右侧栏/);
  const params = tools[0]!.parameters as { required?: string[] };
  assert.deepEqual(params.required, ['path']);
  assert.deepEqual([...routes.keys()].sort(), [EVENTS_ENDPOINT, PUSH_ENDPOINT].sort());
  assert.equal(effects.length, 1);

  effects[0]!();
  assert.equal(routes.size, 0);
});

test('契约：缺服务时只告警、不抛（别把会话搞崩）', () => {
  const { ctx, warnings } = fakeContext();
  const bare: ServerContext = { logger: ctx.logger };
  assert.doesNotThrow(() => apply(bare));
  assert.ok(warnings.length >= 1);
});
