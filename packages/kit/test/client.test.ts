import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openResource, subscribeSse } from '../src/client.js';
import type { ClientContext } from '../src/types.js';

test('openResource：把地址与行号交给右栏；没有右栏服务时返回 false 并告警（不抛）', () => {
  const calls: unknown[] = [];
  const warnings: unknown[][] = [];
  const ctx: ClientContext = {
    sidebarRight: {
      openResource(address, options) {
        calls.push([address, options]);
      },
    },
    logger: { warn: (...args: unknown[]) => warnings.push(args) },
  };
  assert.equal(openResource(ctx, 'dsh-resource://file/session/s1/a.html'), true);
  assert.deepEqual(calls[0], ['dsh-resource://file/session/s1/a.html', undefined]);
  assert.equal(openResource(ctx, 'dsh-resource://file/session/s1/a.html', 12), true);
  assert.deepEqual(calls[1], ['dsh-resource://file/session/s1/a.html', { params: { line: 12 } }]);

  const bare: ClientContext = { logger: { warn: (...args: unknown[]) => warnings.push(args) } };
  assert.equal(openResource(bare, 'x'), false);
  assert.equal(warnings.length, 1);
});

test('openResource：右栏自己抛错时也吞掉（只告警）', () => {
  const warnings: unknown[][] = [];
  const ctx: ClientContext = {
    sidebarRight: {
      openResource() {
        throw new Error('boom');
      },
    },
    logger: { warn: (...args: unknown[]) => warnings.push(args) },
  };
  assert.equal(openResource(ctx, 'x'), false);
  assert.equal(warnings.length, 1);
});

test('subscribeSse：Node 里没有 EventSource 时安静地什么都不做', () => {
  const ctx: ClientContext = {};
  const close = subscribeSse(ctx, '/events', () => {});
  assert.equal(typeof close, 'function');
  close();
});
