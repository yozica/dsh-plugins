/**
 * 浏览器半边：订阅服务端频道，收到帧就请宿主在右侧栏打开那个地址。
 *
 * 构建：`scripts/build-client.mjs` 用 esbuild 把它打成 `lib/client.js`（CJS + loader 包装）。
 * 这里 `import` 的东西**会被打进来**（包括 kit），只有 `@deepseek-ai/*` 是 external。
 *
 * @module @yozica/dsh-plugin-reveal/browser
 */
import { openResource, subscribeSse, type ClientContext } from '@yozica/dsh-plugin-kit/client';

import { EVENTS_ENDPOINT, type RevealFrame } from './shared/endpoints.js';

export const name = 'plugin-reveal';
export const inject = ['sidebarRight'];

/** 校验一帧，别让坏 JSON 碰界面状态 */
export function parseRevealFrame(value: unknown): RevealFrame | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== 'reveal') return null;
  if (typeof record.address !== 'string' || record.address === '') return null;
  const line = typeof record.line === 'number' && Number.isFinite(record.line) ? record.line : null;
  return { type: 'reveal', address: record.address, path: String(record.path ?? ''), line };
}

export function apply(ctx: ClientContext): void {
  subscribeSse(ctx, EVENTS_ENDPOINT, (raw) => {
    const frame = parseRevealFrame(raw);
    if (frame === null) return;
    openResource(ctx, frame.address, frame.line ?? undefined);
  });
}
