/**
 * `@yozica/dsh-plugin-kit` —— 自研 DSH 插件的公共件（**服务端半边**）。
 *
 * 它只做一件事：把"依赖 DSH 内部实现"的部分收在这里，让插件本身**零 @deepseek-ai 依赖**
 * （这样包能发到公共源、谁的 DSH 都能装；DSH 内部 API 变了也只改这一处）。
 *
 * ```ts
 * import { createSseChannel, defineTool, fileAddressFor, requireServerServices } from '@yozica/dsh-plugin-kit';
 * ```
 *
 * @module @yozica/dsh-plugin-kit
 */
export {
  FILE_ADDRESS_PREFIX,
  encodePath,
  encodeSegment,
  fileAddressFor,
  isAbsoluteWorkspacePath,
  isWindowsStylePath,
  parseSessionFileAddress,
  sessionFileAddress,
  type SessionFileAddress,
} from './address.js';
export { createSseChannel, isLoopback, sseData, type SseChannel } from './channel.js';
export {
  DSH_TESTED_VERSION,
  requireClientServices,
  requireServerServices,
  type ServiceReport,
} from './services.js';
export { defineTool, parametersSchema, validateArgs, type ParamSpec } from './tool.js';
export type {
  ClientContext,
  FsEntry,
  JsonSchema,
  ServerContext,
  ServerRequest,
  ServerResponse,
  SidebarRight,
  ToolContent,
  ToolDefinition,
  ToolExec,
} from './types.js';
