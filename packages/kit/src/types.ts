/**
 * 我们用到的宿主（DSH）形状的**最小声明**。
 *
 * 为什么不 import `@deepseek-ai/*` 的类型：那样就把"零 @deepseek-ai 依赖"打破了 ——
 * 包要能发到公共源、谁的 DSH 都能装。这些形状是照着 DSH **0.1.5-rc.2** 抄的，
 * 只声明我们真正用到的部分；DSH 改了就在这一处改（见 docs/plugin-contract.md 的复查表）。
 *
 * @module @yozica/dsh-plugin-kit/types
 */

/** JSON Schema（我们只用得到这个子集） */
export interface JsonSchema {
  type: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean;
}

/** 工具渲染出来的一段内容（宿主认得的最小形状） */
export interface ToolContent {
  type: 'text';
  text: string;
}

/** 工具定义（`ctx.tools.register()` 认的就是这些字段） */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  output: {
    schema: JsonSchema;
    render: (args: unknown, value: unknown) => ToolContent[];
  };
  timeoutMs?: number;
  execute: (args: never, exec: ToolExec) => Promise<unknown>;
}

/** 一次工具调用的执行上下文 */
export interface ToolExec {
  agent?: {
    session: {
      header: { id: string; cwd?: string };
    };
  };
  signal: AbortSignal;
}

/** 宿主提供的服务（只列我们用的） */
export interface FsEntry {
  type: 'file' | 'directory' | 'other';
}

export interface ServerContext {
  tools?: { register(definition: ToolDefinition): unknown };
  webServer?: {
    register(route: {
      kind: 'exact';
      path: string;
      handler: (req: ServerRequest, res: ServerResponse) => void;
    }): () => void;
  };
  fs?: {
    lstat(
      path: string,
      options: { cwd?: string },
      signal?: AbortSignal,
    ): Promise<FsEntry | undefined>;
  };
  logger?: { warn(...args: unknown[]): void; info?(...args: unknown[]): void };
  /** cordis 的清理注册：返回的 dispose 在插件卸载时调用 */
  effect?(body: () => (() => void) | void, label?: string): void;
}

/** 极简的请求 / 响应形状（够写 SSE 与测试假件） */
export interface ServerRequest {
  method?: string;
  url?: string;
  socket?: { remoteAddress?: string };
  on(event: 'close', listener: () => void): void;
}

export interface ServerResponse {
  writeHead(status: number, headers?: Record<string, string>): void;
  write(chunk: string): void;
  end(body?: string): void;
  destroy?(): void;
  on(event: 'close', listener: () => void): void;
}

/** 浏览器半边：宿主提供的右栏跨插件面 */
export interface SidebarRight {
  openResource(address: string, options?: { params?: Record<string, unknown> }): void;
  openTab?(kind: string, options?: Record<string, unknown>): void;
}

/** 浏览器半边的插件上下文（只列我们用的） */
export interface ClientContext {
  sidebarRight?: SidebarRight;
  effect?(body: () => (() => void) | void): void;
  logger?: { warn(...args: unknown[]): void };
}
