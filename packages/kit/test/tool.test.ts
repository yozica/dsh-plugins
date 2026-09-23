import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defineTool, parametersSchema, validateArgs } from '../src/tool.js';

test('紧凑写法 → JSON Schema：required 汇总、additionalProperties 关掉、数组默认 string', () => {
  const schema = parametersSchema({
    path: { type: 'string', required: true, description: '要打开的文件' },
    line: { type: 'integer' },
    tags: { type: 'array' },
  });
  assert.deepEqual(schema, {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: {
      path: { type: 'string', description: '要打开的文件' },
      line: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  });
});

test('validateArgs：必填缺失 / 类型不对都抛模型看得懂的话', () => {
  const schema = parametersSchema({
    path: { type: 'string', required: true },
    line: { type: 'integer' },
  });
  assert.throws(() => validateArgs(schema, {}, 'reveal'), /缺少必填参数 "path"/);
  assert.throws(() => validateArgs(schema, { path: 1 }, 'reveal'), /应该是 string/);
  assert.throws(() => validateArgs(schema, { path: 'a', line: 1.5 }, 'reveal'), /应该是 integer/);
  assert.doesNotThrow(() => validateArgs(schema, { path: 'a', line: 3 }, 'reveal'));
});

test('defineTool：产出宿主认得的四样东西，执行前先校验参数', async () => {
  const calls: unknown[] = [];
  const tool = defineTool({
    name: 'demo',
    description: '演示用',
    parameters: { path: { type: 'string', required: true } },
    output: {
      schema: { ok: { type: 'boolean', required: true } },
      render: (_args, value) => [{ type: 'text', text: String((value as { ok: boolean }).ok) }],
    },
    timeoutMs: 5000,
    async execute(args) {
      calls.push(args);
      return { ok: true };
    },
  });
  assert.equal(tool.name, 'demo');
  assert.equal(tool.parameters.type, 'object');
  assert.equal(tool.output.schema.type, 'object');
  assert.equal(tool.timeoutMs, 5000);
  assert.equal(typeof tool.output.render, 'function');
  // 正常调用
  const result = (await tool.execute(
    { path: 'a' } as never,
    { signal: new AbortController().signal } as never,
  )) as {
    ok: boolean;
  };
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  // 参数不对：在 execute 之前就拦下
  await assert.rejects(
    () => tool.execute({} as never, { signal: new AbortController().signal } as never),
    /缺少必填参数 "path"/,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(tool.output.render({} as never, { ok: true } as never), [
    { type: 'text', text: 'true' },
  ]);
});
