import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSseChannel, isLoopback, sseData } from '../src/channel.js';
import type { ServerContext, ServerRequest, ServerResponse } from '../src/types.js';

/** 一个够用的假响应：记下写了什么 */
function fakeResponse() {
  const written: string[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const res: ServerResponse & { written: string[]; destroyed: boolean } = {
    written,
    destroyed: false,
    writeHead(status) {
      written.push(`#status ${status}`);
    },
    write(chunk) {
      written.push(chunk);
    },
    end(body) {
      if (body !== undefined) written.push(body);
    },
    destroy() {
      res.destroyed = true;
    },
    on(event, listener) {
      (listeners[event] ??= []).push(listener);
    },
  };
  return { res, fire: (event: string) => (listeners[event] ?? []).forEach((l) => l()) };
}

function fakeContext() {
  const routes = new Map<string, (req: ServerRequest, res: ServerResponse) => void>();
  const ctx: ServerContext = {
    webServer: {
      register(route) {
        routes.set(route.path, route.handler);
        return () => routes.delete(route.path);
      },
    },
  };
  return { ctx, routes };
}

test('SSE 一帧的形状固定', () => {
  assert.equal(sseData({ type: 'x' }), 'data: {"type":"x"}\n\n');
});

test('频道：GET 建立连接、广播推到每个连接、非 GET 405、dispose 断开', () => {
  const { ctx, routes } = fakeContext();
  const channel = createSseChannel(ctx);
  channel.register('/plugin-demo/events');
  const handler = routes.get('/plugin-demo/events');
  assert.equal(typeof handler, 'function');

  const a = fakeResponse();
  const b = fakeResponse();
  handler!({ method: 'GET', socket: { remoteAddress: '127.0.0.1' }, on: () => {} }, a.res);
  handler!({ method: 'GET', socket: { remoteAddress: '127.0.0.1' }, on: () => {} }, b.res);
  assert.equal(channel.clients, 2);
  assert.equal(a.res.written[0], '#status 200');
  assert.equal(a.res.written[1], ': channel\n\n');

  assert.equal(channel.broadcast({ type: 'reveal', address: 'x' }), 2);
  assert.equal(a.res.written.at(-1), 'data: {"type":"reveal","address":"x"}\n\n');
  assert.equal(b.res.written.at(-1), 'data: {"type":"reveal","address":"x"}\n\n');

  const bad = fakeResponse();
  handler!({ method: 'POST', on: () => {} }, bad.res);
  assert.equal(bad.res.written[0], '#status 405');

  channel.dispose();
  assert.equal(channel.clients, 0);
  assert.equal(a.res.destroyed, true);
});

test('断开后不再推送', () => {
  const { ctx, routes } = fakeContext();
  const channel = createSseChannel(ctx);
  channel.register('/x');
  const { res, fire } = fakeResponse();
  routes.get('/x')!({ method: 'GET', on: () => {} }, res);
  assert.equal(channel.clients, 1);
  fire('close');
  assert.equal(channel.clients, 0);
  assert.equal(channel.broadcast({ type: 'y' }), 0);
});

test('只认本机地址', () => {
  assert.equal(isLoopback({ socket: { remoteAddress: '127.0.0.1' }, on: () => {} }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '::1' }, on: () => {} }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '10.0.0.7' }, on: () => {} }), false);
  assert.equal(isLoopback(undefined), false);
});
