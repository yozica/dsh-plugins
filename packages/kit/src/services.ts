/**
 * 宿主要求的**能力断言**（比"比版本号"更有用）。
 *
 * DSH 还在 rc，版本号会动；真正决定能不能跑的是"那几个服务在不在"。
 * 插件 `apply()` 开头调一次：缺什么就**在日志里说清楚**，而不是半路抛异常让会话难看。
 *
 * @module @yozica/dsh-plugin-kit/services
 */
import type { ClientContext, ServerContext } from './types.js';

/** 本 kit 是在这个 DSH 版本上核对出来的 */
export const DSH_TESTED_VERSION = '0.1.5-rc.2';

export interface ServiceReport {
  ok: boolean;
  missing: string[];
}

/** 服务端半边：要求哪些服务（名字就是 `ctx.<name>`） */
export function requireServerServices(ctx: ServerContext, names: readonly string[]): ServiceReport {
  const record = ctx as unknown as Record<string, unknown>;
  const missing = names.filter((name) => record[name] === undefined || record[name] === null);
  if (missing.length > 0) {
    ctx.logger?.warn(
      `[dsh-plugin-kit] 这个 DSH 缺少服务：${missing.join(', ')}（kit 是按 ${DSH_TESTED_VERSION} 核对的）—— ` +
        '插件会继续挂载，但相关功能不可用。',
    );
  }
  return { ok: missing.length === 0, missing };
}

/** 浏览器半边：要求哪些服务 */
export function requireClientServices(ctx: ClientContext, names: readonly string[]): ServiceReport {
  const record = ctx as unknown as Record<string, unknown>;
  const missing = names.filter((name) => record[name] === undefined || record[name] === null);
  if (missing.length > 0) {
    ctx.logger?.warn(
      `[dsh-plugin-kit] 这个界面缺少服务：${missing.join(', ')}（kit 是按 ${DSH_TESTED_VERSION} 核对的）。`,
    );
  }
  return { ok: missing.length === 0, missing };
}
