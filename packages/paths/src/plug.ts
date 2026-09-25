/**
 * 注册与组件 —— **不 import React**：`createElement` 与三个 hook 由 `browser.ts` 注入
 * （见 `view.ts` 的同款理由）。契约测试用假 ctx + 假 `h` 直接跑这里，不需要 DOM 也不需要 React。
 *
 * 注册形状与官方 documentpreview **完全一致**（这是踩过坑的地方，改之前先看 `docs/panel-path-links.md`）：
 *
 * - 只注册子槽位 `sidebar.right.tab.document`，`key` = 自己 body 定义的 id；
 * - **不注册父槽位** `sidebar.right.pane.tab`（那是官方包按 tab 种类注册的）；
 * - body 定义**必须带 `loading`**：`text-pages` 给 Markdown（分页读文本），
 *   `bytes-complete` 给 HTML（一次读完整字节）；漏了它官方 TextPreview 不读文件、也不 renderSlot。
 *
 * @module @yozica/dsh-plugin-paths/plug
 */
import { BRIDGE_SOURCE, frameDocument } from './bridge.js';
import type { DocumentPreviewDefinition, PathsContext } from './host.js';
import { decodeUtf8, packAssets, type ReadRelated } from './html.js';
import type { PathTarget } from './paths.js';
import { renderMarkdown, type H, type PathSource } from './view.js';

/** `createElement` 之外，我们还需要三个 React hook（同样由 `browser.ts` 注入） */
export interface Hooks {
  useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void];
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  useRef<T>(initial: T): { current: T };
}

/** body 组件从槽位收到的 props（官方 `renderSlot` 传的那几样 + 我们 `inject` 的） */
export interface BodyProps {
  readonly resourceAddress?: string;
  readonly content?: {
    readonly kind?: string;
    readonly text?: string;
    readonly data?: Uint8Array;
  };
  readonly readRelated?: ReadRelated;
  readonly useTabInfo?: () => { readonly tab?: { readonly signal?: AbortSignal } };
}

/** 点击路径时的来源信息（外层用它定位会话与当前文件） */
export interface PathOrigin {
  readonly resourceAddress?: string;
  readonly source: PathSource;
}

export interface RegisterDeps {
  readonly h: H;
  readonly hooks: Hooks;
  readonly readRelated?: ReadRelated;
  readonly onOpenPath: (target: PathTarget, origin: PathOrigin) => void;
  readonly onExternal: (url: string) => void;
}

interface Target {
  readonly suffix: string;
  readonly extensions: readonly string[];
  readonly loading: DocumentPreviewDefinition['loading'];
  readonly wrap: boolean;
  readonly component: (props: BodyProps) => unknown;
  /** HTML 需要 `readRelated`，Markdown 不需要 */
  readonly needsRelated: boolean;
}

/** 注册两种 body。幂等：由调用方用 `ctx.effect` 包住（与官方一致）。 */
export function registerBodies(ctx: PathsContext, deps: RegisterDeps): void {
  const targets: readonly Target[] = [
    {
      suffix: 'md',
      extensions: ['md', 'markdown'],
      loading: 'text-pages',
      wrap: false,
      component: createMarkdownBody(deps),
      needsRelated: false,
    },
    {
      suffix: 'html',
      extensions: ['html', 'htm'],
      loading: 'bytes-complete',
      wrap: false,
      component: createHtmlBody(deps),
      needsRelated: true,
    },
  ];

  for (const target of targets) {
    const id = `plugin-paths:${target.suffix}`;
    const definition: DocumentPreviewDefinition = {
      id,
      extensions: target.extensions,
      priority: 'extension',
      title: () => `${target.suffix === 'md' ? 'Markdown' : 'HTML'} · paths`,
      loading: target.loading,
      wrap: target.wrap,
    };
    const related = deps.readRelated;

    ctx.effect?.(
      () => ctx.documentPreviews.register(definition),
      `paths: ${target.suffix} body 定义`,
    );
    ctx.effect?.(
      () =>
        ctx.slots.inject('sidebar.right.tab.document', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.tab.document',
              key: id,
              ...(target.needsRelated && related !== undefined
                ? { inject: () => ({ readRelated: related }) }
                : {}),
            },
            target.component,
          ),
        ),
      `paths: ${target.suffix} body 组件`,
    );
  }
}

/** Markdown body：解析 + 渲染。**刻意不用 hook** —— 解析是纯函数，出错就退回原文。 */
function createMarkdownBody(deps: RegisterDeps): (props: BodyProps) => unknown {
  return function MarkdownBody(props: BodyProps): unknown {
    const content = props.content;
    const source =
      content !== undefined && content.kind === 'text' && typeof content.text === 'string'
        ? content.text
        : '';
    const openPath = (target: PathTarget, source_: PathSource): void => {
      deps.onOpenPath(target, { resourceAddress: props.resourceAddress, source: source_ });
    };
    try {
      return renderMarkdown(source, { h: deps.h, onOpenPath: openPath });
    } catch (error) {
      // 解析/渲染炸了就显示原文：宁可难看，也不要白屏
      return deps.h('pre', { className: 'dsh-paths-pre', 'data-dsh-paths-fallback': true }, source);
    }
  };
}

/** HTML body：解密 → 打包相对资源 → 交给 iframe；点击经 postMessage 回来。 */
function createHtmlBody(deps: RegisterDeps): (props: BodyProps) => unknown {
  interface FrameState {
    readonly status: 'loading' | 'ready' | 'error';
    readonly srcDoc: string;
  }

  return function HtmlBody(props: BodyProps): unknown {
    const { h, hooks } = deps;
    const [state, setState] = hooks.useState<FrameState>({ status: 'loading', srcDoc: '' });
    const frameRef = hooks.useRef<{ contentWindow: unknown } | null>(null);

    const content = props.content;
    const data =
      content !== undefined && content.kind === 'bytes' && content.data !== undefined
        ? content.data
        : null;
    const address = props.resourceAddress ?? '';
    const readRelated = props.readRelated ?? deps.readRelated;
    const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined;
    const signal = info?.tab?.signal;

    hooks.useEffect(() => {
      if (data === null) {
        setState({ status: 'error', srcDoc: '' });
        return;
      }
      let html = '';
      try {
        html = decodeUtf8(data);
      } catch {
        setState({ status: 'error', srcDoc: '' });
        return;
      }
      let cancelled = false;
      void packAssets(html, address, readRelated, signal)
        .then((assets) => {
          if (!cancelled) setState({ status: 'ready', srcDoc: frameDocument(html, assets) });
        })
        .catch(() => {
          if (!cancelled) setState({ status: 'error', srcDoc: '' });
        });
      return () => {
        cancelled = true;
      };
    }, [data, address]);

    hooks.useEffect(() => {
      const onMessage = (event: { readonly source?: unknown; readonly data?: unknown }): void => {
        const frame = frameRef.current;
        if (frame === null || event.source !== frame.contentWindow) return;
        const payload = event.data as
          | {
              readonly source?: unknown;
              readonly kind?: unknown;
              readonly target?: unknown;
              readonly line?: unknown;
            }
          | null
          | undefined;
        if (payload === null || payload === undefined || payload.source !== BRIDGE_SOURCE) return;
        const target = typeof payload.target === 'string' ? payload.target : '';
        if (target === '') return;
        if (payload.kind === 'url') {
          deps.onExternal(target);
          return;
        }
        if (payload.kind !== 'path') return;
        const line =
          typeof payload.line === 'number' && Number.isFinite(payload.line)
            ? payload.line
            : undefined;
        deps.onOpenPath(
          { path: target, ...(line === undefined ? {} : { line }) },
          { resourceAddress: props.resourceAddress, source: 'html' },
        );
      };
      window.addEventListener('message', onMessage as EventListener);
      return () => window.removeEventListener('message', onMessage as EventListener);
    }, []);

    if (state.status !== 'ready') {
      return h(
        'p',
        { className: 'dsh-paths-status', 'data-dsh-paths-state': state.status },
        state.status === 'error' ? '无法预览这份 HTML 文档。' : '正在准备 HTML 预览…',
      );
    }
    return h('iframe', {
      ref: frameRef,
      className: 'dsh-paths-frame',
      sandbox: 'allow-scripts',
      srcDoc: state.srcDoc,
      title: 'HTML 文档预览',
      'data-dsh-paths-frame': true,
    });
  };
}
