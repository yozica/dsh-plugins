/**
 * 浏览器半边（**正式实现**）：接管官方 md / html 的 body，自己渲染，让内容里的文件路径可点。
 *
 * 机制、实证与踩坑都在 `docs/panel-path-links.md`；这里只放"接线"：
 *
 * - **只注册子槽位** `sidebar.right.tab.document`，父槽位由官方 documentpreview 包按 tab 种类注册；
 * - body 定义必须带 `loading`（md `text-pages` / html `bytes-complete`），漏了会卡在「正在读取…」；
 * - 这是本包**唯一** `import react` 的文件（宿主 `require('react')` 提供），
 *   所以它被 `tsconfig.json` 排除在 tsc 之外，只由 `scripts/build-client.mjs` 用 esbuild 打包。
 *
 * ## 服务怎么拿（真机踩过三次，别改回去）
 *
 * cordis 的 `ctx` 是代理，三条规矩都得记住：
 *
 * 1. **没在 `inject` 里声明的服务，读一下就直接抛** —— 第一版没声明 `remote` 就用了 `ctx.remote`，
 *    结果是整页 `Failed to load plugins`（宿主还会因此把插件从 profile 的 `bundles` 里自动摘掉）；
 * 2. **`inject` 里只要有一个服务没被提供，fiber 就停在 INACTIVE，`apply` 根本不会执行**（静默！）
 *    —— 第二版一口气声明了 `remote` / `remote.workspaceFiles`，插件就"消失"了：没报错、没渲染；
 * 3. **嵌套服务名是独立的服务**：官方注入的是 `remote` *和* `remote.workspaceFiles` 两个名字，
 *    只拿到 `remote` 那个面、再读它的 `.workspaceFiles`，一样触发第 1 条守卫。
 *
 * 所以规矩是：**`inject` 只放"没有它就完全没意义"的服务**（`documentPreviews` / `slots`，
 * 探针已经证明这两个在本插件的 fiber 里一定拿得到），其余一律走 `src/services.ts` 的
 * `serviceOf()` —— 它先试 **`ctx.get(name)`**（cordis 官方推荐、社区踩坑后的标准修法），
 * 再退到 `ctx.reflect.get(name, false)`。拿不到返回 `undefined`，不抛、也不影响 fiber 激活。
 * **永远不要直接写 `ctx.xxx`。**
 *
 * @module @yozica/dsh-plugin-paths/browser
 */
import { parseSessionFileAddress } from '@yozica/dsh-plugin-kit/client';
import * as React from 'react';

import type { PathsContext } from './host.js';
import { decodeBase64, decodeUtf8, type ReadRelated } from './html.js';
import type { PathTarget } from './paths.js';
import { registerBodies, type PathOrigin } from './plug.js';
import { missingReact, serviceOf } from './services.js';
import { STRINGS } from './strings.js';
import { ensureStyles } from './styles.js';
import { openFileTarget } from './target.js';

export const name = 'plugin-paths';

/** 只有这两个是硬依赖：没有它们，注册 body / 组件这件事根本无从谈起。 */
export const inject = ['documentPreviews', 'slots'];

/**
 * 我们自己的错误边界 —— **在工厂里定义，不在模块作用域**。
 *
 * 为什么必须有：**我们返回的树一旦在 React 渲染/提交期抛错，React 会卸载整棵子树**，
 * 用户看到一片空白 —— 而 `dshmarket` 的 #293 正是这么白屏了好几个月（浏览器翻译改写了
 * React 的文本节点，下一次更新就抛 `NotFoundError`）。有边界至少能退回显示原文。
 *
 * 为什么在工厂里：`class X extends React.Component` 是在**模块求值时**执行的。宿主 react 若缺
 * `Component`（旧宿主 / 半成品），模块直接就挂 —— 那时连 `apply` 里的能力自检都跑不到，
 * 也就谈不上"干净降级"（`check-dist` 用假 `require` 正是这么把这个坑抓出来的）。
 */
function createGuard(
  react: Record<string, unknown>,
): (child: unknown, fallback: unknown) => unknown {
  const Component = react['Component'] as new () => {
    props: { children?: unknown; fallback?: unknown };
    state: { error: Error | null };
    render(): unknown;
  };
  const createElement = react['createElement'] as (
    type: unknown,
    props?: unknown,
    ...children: unknown[]
  ) => unknown;

  class PathsBoundary extends Component {
    state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: Error): { error: Error } {
      return { error };
    }

    componentDidCatch(error: Error, info?: { componentStack?: string | null }): void {
      try {
        document.documentElement.setAttribute('data-dsh-paths-crashed', error.message);
      } catch {
        /* 标记失败无所谓 */
      }
      console.error('[dsh-plugin-paths] 渲染崩溃，已退回显示原文', error, info?.componentStack);
    }

    render(): unknown {
      if (this.state.error === null) return this.props.children;
      return createElement('div', { 'data-dsh-paths-crashed': true }, [
        createElement('p', { key: 'note', className: 'dsh-paths-status' }, STRINGS.renderCrash),
        this.props.fallback,
      ]);
    }
  }

  return (child, fallback) => createElement(PathsBoundary, { fallback }, child);
}

/**
 * 挂载/点击出错时**别静默**：右下角一条红条，同时给 `<html>` 打一个 `data-dsh-paths-failed`。
 *
 * 为什么要留这个：打包版 Console 里 DSH 界面是 guest `<webview>`，**console 不落盘**
 * （`console.log` 进不去，warning 也没写），所以"悄悄失效"是最贵的故障 ——
 * 这条线正是这么来回重启了五轮。成功时这个函数根本不会被调用，界面干干净净。
 */
function reportFailure(error: unknown): void {
  try {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-dsh-paths-failed', message);
    if (document.getElementById('dsh-paths-failed') !== null) return;
    const host = document.body ?? document.documentElement;
    const node = document.createElement('div');
    node.id = 'dsh-paths-failed';
    node.style.cssText =
      'position:fixed;right:8px;bottom:8px;z-index:2147483647;font:11px/1.5 ui-monospace,monospace;' +
      'padding:4px 8px;border-radius:6px;max-width:60vw;white-space:pre-wrap;background:#c0392b;color:#fff';
    node.textContent = STRINGS.mountFailed(message);
    host.appendChild(node);
  } catch {
    /* 兜底本身不该抛 */
  }
}

interface SidebarRightLike {
  openResource(address: string, options?: { params?: Record<string, unknown> }): void;
}

interface WorkspaceFilesLike {
  read(
    sessionId: string,
    path: string,
    range: { offset: number },
    signal?: AbortSignal,
  ): Promise<{ readonly ok: boolean }>;
  readRelated(
    sessionId: string,
    path: string,
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<
    | { readonly ok: true; readonly value: { readonly data: string } }
    | { readonly ok: false; readonly error: { readonly message: string } }
  >;
}

/**
 * WorkspaceFiles 这个面：**必须用完整的嵌套服务名去读**。
 *
 * 官方 documentpreview 注入的是 `remote` *和* `remote.workspaceFiles` 两个名字；
 * `remote` 那个面本身也是代理，在它身上读 `.workspaceFiles` 会触发
 * `cannot get property "remote.workspaceFiles" without inject`（真机红条实测）。
 */
function workspaceFilesOf(ctx: PathsContext): WorkspaceFilesLike | undefined {
  const direct = serviceOf<WorkspaceFilesLike>(ctx, 'remote.workspaceFiles');
  if (direct !== undefined) return direct;
  try {
    return serviceOf<{ workspaceFiles?: WorkspaceFilesLike }>(ctx, 'remote')?.workspaceFiles;
  } catch {
    return undefined;
  }
}

export function apply(ctx: PathsContext): void {
  // 挂载失败**不许**拖垮界面：宿主会把 apply 抛错渲染成整页 "Failed to load plugins"，
  // 而我们失败时正文交回官方 body 就行（少一个能力，不是坏一个页面）。
  try {
    // 先自检宿主能力（对齐 dshmarket 的 missingPrimitives）：缺了就干净跳过，
    // 而不是注册一个渲染时才炸的 body。
    const gaps = missingReact(React as unknown as Record<string, unknown>);
    if (gaps.length > 0) {
      ctx.logger?.warn(`${STRINGS.missingReact}${gaps.join(', ')}`);
      return;
    }
    registerBodies(ctx, {
      h: React.createElement,
      hooks: {
        useState: React.useState,
        useEffect: React.useEffect,
        useRef: React.useRef,
        useMemo: React.useMemo,
      },
      readRelated: createReadRelated(ctx),
      onOpenPath: (target, origin) => {
        // 点击里的异常别变成"点了没反应"：冒到红条上，一次就能看见
        void openTarget(ctx, target, origin).catch((error: unknown) => reportFailure(error));
      },
      onExternal: (url) => {
        openExternal(ctx, url);
      },
      // 边界在能力自检**之后**才构造（见 createGuard 的注释）
      guard: createGuard(React as unknown as Record<string, unknown>),
    });
    ensureStyles();
  } catch (error) {
    reportFailure(error);
    ctx.logger?.warn(STRINGS.mountFailedLog, error);
  }
}

/** 把 `readRelated` 绑到 Remote（HTML 的相对资源用）；拿不到服务就返回 `undefined`（那半边降级） */
function createReadRelated(ctx: PathsContext): ReadRelated | undefined {
  const workspaceFiles = workspaceFilesOf(ctx);
  if (workspaceFiles === undefined) return undefined;
  return async (address, relativePath, signal) => {
    const reference = parseSessionFileAddress(address);
    if (reference === null) throw new Error(STRINGS.badAddress);
    const result = await workspaceFiles.readRelated(
      reference.sessionId,
      reference.path,
      relativePath,
      signal,
    );
    if (!result.ok) throw new Error(result.error.message);
    return { text: decodeUtf8(decodeBase64(result.value.data)) };
  };
}

/** 存在性探测（相对路径先看"文件所在目录"、再看"工作区根"时用）；拿不到服务就不探测 */
function createExists(
  ctx: PathsContext,
  sessionId: string,
): ((path: string) => Promise<boolean>) | undefined {
  const workspaceFiles = workspaceFilesOf(ctx);
  if (workspaceFiles === undefined) return undefined;
  return async (path: string): Promise<boolean> => {
    const result = await workspaceFiles.read(sessionId, path, { offset: 1 });
    return result.ok;
  };
}

/** 右侧栏服务：一律走非严格读取（没在 inject 里声明，直接读 `ctx.sidebarRight` 会抛） */
function sidebarRightOf(ctx: PathsContext): SidebarRightLike | undefined {
  return serviceOf<SidebarRightLike>(ctx, 'sidebarRight');
}

/** 打开一个正文里的路径 */
async function openTarget(
  ctx: PathsContext,
  target: PathTarget,
  origin: PathOrigin,
): Promise<void> {
  const sidebar = sidebarRightOf(ctx);
  if (sidebar === undefined) {
    ctx.logger?.warn(STRINGS.noSidebarService);
    return;
  }
  const address = origin.resourceAddress;
  const reference =
    typeof address === 'string' && address !== '' ? parseSessionFileAddress(address) : null;
  if (reference === null) {
    ctx.logger?.warn(STRINGS.notSessionAddress, address);
    return;
  }
  await openFileTarget(
    {
      sessionId: reference.sessionId,
      filePath: reference.path,
      exists: createExists(ctx, reference.sessionId),
      open: (resource, line) => {
        sidebar.openResource(resource, line === undefined ? undefined : { params: { line } });
      },
    },
    target,
  );
}

/** 交给系统浏览器：Console 里 guest 的 window-open 处理器会接走它 */
function openExternal(ctx: PathsContext, url: string): void {
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (error) {
    ctx.logger?.warn('[dsh-plugin-paths] 打开外链失败：', error);
  }
}
