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

/** 一份会话作用域文件地址解出来的会话与路径 */
export interface SessionFileAddress {
  readonly sessionId: string;
  /** 工作区相对路径，或**保留前导 `/` 的绝对路径**（工作区外） */
  readonly path: string;
}

/**
 * `sessionFileAddress()` 的逆运算 —— 从地址里取回会话与路径。
 *
 * 只认 `dsh-resource://file/session/<sessionId>/<path>`；地址里路径那一段可能以 `/` 开头
 * （工作区外的绝对路径，见文件头），所以**按会话 id 后面的第一个 `/` 切一刀**即可：
 * `…/session/s1//tmp/a.png` → sessionId `s1`、path `/tmp/a.png`。
 *
 * 其它形状（`absolute:` 作用域、非 `file` 资源、空地址）一律返回 `null`，交给调用方决定怎么办。
 */
export function parseSessionFileAddress(address: string): SessionFileAddress | null {
  const prefix = `${FILE_ADDRESS_PREFIX}session/`;
  if (typeof address !== 'string' || !address.startsWith(prefix)) return null;
  const rest = address.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const rawSession = rest.slice(0, slash);
  if (rawSession === '') return null;
  const rawPath = rest.slice(slash + 1);
  try {
    return { sessionId: decodeURIComponent(rawSession), path: decodeURIComponent(rawPath) };
  } catch {
    return null; // 坏百分号编码：当作没解出来，别让界面炸
  }
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
