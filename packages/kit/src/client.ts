/**
 * `@yozica/dsh-plugin-kit/client` —— 浏览器半边用得上的公共件。
 *
 * 插件写客户端那半时 `import` 这里的东西；**构建时 kit 会被打进插件的客户端产物**
 * （不是 external），所以插件自己在浏览器里不需要单独加载 kit。
 *
 * @module @yozica/dsh-plugin-kit/client
 */
import { requireClientServices } from './services.js';
import type { ClientContext, SidebarRight } from './types.js';

// 浏览器半边也能用地址逻辑（纯字符串，不碰文件系统）：`browser.ts` 里 import 的时候
// 不该把 kit 的服务端半边（channel/tool）一起打进来，所以在这里再导出一次。
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

/**
 * 订阅服务端的 SSE 频道，收到帧回调。
 *
 * 收尾交给 `ctx.effect`（宿主卸载插件时会调）；没有 `effect` 就退化成不管 —— 只是泄漏一个连接，
 * 不影响功能。
 */
export function subscribeSse(
  ctx: ClientContext,
  path: string,
  onFrame: (frame: unknown) => void,
): () => void {
  if (typeof EventSource !== 'function') return () => {};
  const source = new EventSource(path);
  source.addEventListener('message', (event: MessageEvent) => {
    let frame: unknown;
    try {
      frame = JSON.parse(String((event as MessageEvent).data));
    } catch {
      return; // 坏帧丢掉，不影响界面
    }
    try {
      onFrame(frame);
    } catch (error) {
      ctx.logger?.warn('[dsh-plugin-kit] 处理推送时出错：', error);
    }
  });
  const close = () => source.close();
  if (typeof ctx.effect === 'function') ctx.effect(() => close);
  return close;
}

/** 右栏：打开一个资源地址（拿不到右栏服务时**静默跳过**，不吵用户） */
export function openResource(ctx: ClientContext, address: string, line?: number): boolean {
  const { ok } = requireClientServices(ctx, ['sidebarRight']);
  if (!ok) return false;
  const sidebar: SidebarRight | undefined = ctx.sidebarRight;
  try {
    if (line === undefined) sidebar?.openResource(address);
    else sidebar?.openResource(address, { params: { line } });
    return true;
  } catch (error) {
    ctx.logger?.warn('[dsh-plugin-kit] 打开右侧栏失败：', error);
    return false;
  }
}
