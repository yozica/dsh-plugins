/**
 * 我们把宿主（DSH）用到的形状**只在这一处**描述（kit 的防火墙思路）。
 *
 * 不 import `@deepseek-ai/*` 的类型：包要能发到公共源、谁的 DSH 都能装。这里抄的是
 * DSH 0.1.5-rc.2 上核对过的形状，上游改了就在这一处改。
 *
 * @module @yozica/dsh-plugin-panel-body/host
 */

/** 官方 `TextPreview` 支持的两种读取方式；body 定义必须与内容形态一致 */
export type LoadingMode = 'text-pages' | 'bytes-complete';

/** 一份 body 定义（`ctx.documentPreviews.register` 的入参） */
export interface DocumentPreviewDefinition {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly priority: 'builtin' | 'extension' | 'fallback';
  readonly title: () => string;
  readonly loading: LoadingMode;
  readonly wrap: boolean;
}

/** 子槽位注册能带的注入：body 组件会以 props 收到这些字段 */
export interface DocumentSlotInjection {
  readonly readRelated?: (
    address: string,
    relativePath: string,
    signal: AbortSignal,
  ) => Promise<{ readonly text: string }>;
}

/** 浏览器半边的插件上下文（只列我们用的） */
export interface PathsContext {
  readonly documentPreviews: {
    register(definition: DocumentPreviewDefinition): unknown;
  };
  readonly slots: {
    inject(name: string, callback: () => unknown): unknown;
    register(
      target: {
        readonly name: string;
        readonly key: string;
        readonly inject?: () => DocumentSlotInjection;
      },
      component: unknown,
    ): unknown;
  };
  readonly sidebarRight?: {
    openResource(address: string, options?: { params?: Record<string, unknown> }): void;
  };
  readonly remote?: {
    readonly workspaceFiles?: {
      read(
        sessionId: string,
        path: string,
        range: { offset: number },
        signal?: AbortSignal,
      ): Promise<{ readonly ok: boolean }>;
      /**
       * 解析一个路径并报告它的事实（**存在性 + 绝对路径**）。
       *
       * 为什么不能用 `read` 代替：`read` 只回答"读得到吗"，而我们要的是
       * **把候选解析成绝对路径**（`value.absolutePath`）—— 相对路径经 `..` 越过工作区根、
       * 或本来就是工作区外的绝对路径时，只有宿主知道它落到哪儿。
       * 上游契约：`path` 允许"绝对路径或工作区相对路径"，**工作区外也允许**。
       */
      stat(
        sessionId: string,
        path: string,
        signal?: AbortSignal,
      ): Promise<
        | { readonly ok: true; readonly value: { readonly absolutePath: string } }
        | { readonly ok: false; readonly error: { readonly message: string } }
      >;
      readRelated(
        sessionId: string,
        path: string,
        relativePath: string,
        signal?: AbortSignal,
      ): Promise<
        | { readonly ok: true; readonly value: { readonly data: string } }
        | { readonly ok: false; readonly error: { readonly message: string } }
      >;
    };
  };
  readonly logger?: { warn(...args: unknown[]): void };
  /**
   * cordis 的反射层。用 `get(name, false)` **非严格读取**可选服务：
   * 服务不存在时返回 `undefined`（而 `ctx.<name>` 会直接抛，把服务写进 `inject`
   * 又会让 fiber 在服务缺失时静默不激活 —— 两条真机都踩过）。
   */
  readonly reflect?: { get?(name: string, strict?: boolean): unknown };
  effect?(run: () => unknown, label?: string): unknown;
}
