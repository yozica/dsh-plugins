/**
 * `dsh-resource://file/…` 地址语法 —— 纯字符串逻辑，不碰文件系统。
 *
 * 语义与 DSH 自带的 `@deepseek-ai/dsh-util-workspace-path` 一致（那是个没有客户端面的包，
 * 浏览器里 require 不到，所以这里自己实现一份并单测）。
 *
 * **关键的一条**：工作区**外**的绝对路径要**保留前导 `/`**（地址里出现两个斜杠）——
 * 解析回来才是 `/tmp/x.png` 这个绝对路径；少了它就变成相对工作区的另一个文件。
 *
 * @module @yozica/dsh-plugin-kit/address
 */

export const FILE_ADDRESS_PREFIX = 'dsh-resource://file/';

/** 编码一段 id / 路径（`:` 保留字面量，给 Windows 盘符用） */
export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':');
}

/** 按段编码一条 `/` 分隔的路径 */
export function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/');
}

/** 是不是 Windows 盘符 / UNC 那种绝对路径 */
export function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\');
}

/** 是不是绝对路径（POSIX 或 Windows 拼法） */
export function isAbsoluteWorkspacePath(path: string): boolean {
  return path.startsWith('/') || isWindowsStylePath(path);
}

/** 一份会话作用域的文件地址 */
export function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = String(path)
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '');
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
}

/**
 * 把一个路径变成"这份会话能打开"的地址。
 *
 * - 相对路径：直接编码；
 * - 绝对且在工作区内：去掉 `cwd/` 前缀；
 * - 绝对且在**工作区外**：原样编码（保留前导 `/`，见文件头说明）。
 */
export function fileAddressFor(sessionId: string, cwd: string | undefined, path: string): string {
  const normalized = String(path).replace(/\\/g, '/');
  if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
  const root =
    cwd === undefined || cwd === '' ? '' : String(cwd).replace(/\\/g, '/').replace(/\/+$/, '');
  if (root !== '' && normalized === root) return sessionFileAddress(sessionId, '');
  if (root !== '' && normalized.startsWith(`${root}/`)) {
    return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
  }
  return sessionFileAddress(sessionId, normalized);
}
