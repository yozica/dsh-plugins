/**
 * 地址与帧的**纯逻辑**（不 import 任何 DSH 包）—— 这样它能脱离 profile 单独跑测试
 * （`npm test`，见 test/address.test.mjs），而 `lib/index.js` 只负责把它们接上 DSH。
 *
 * 语法与 `@deepseek-ai/dsh-util-workspace-path` 的同名函数同构：`dsh-resource://file/session/<id>/<path>`。
 * 为什么服务端要自己算：算出**最终地址**之后，浏览器那一半只需要一个
 * `ctx.sidebarRight.openResource(address)`，不必再注入 sessions 服务去查 cwd —— 桥越窄越耐改。
 *
 * @module dsh-plugin-reveal/address
 */

/** 每个文件地址的开头 */
export const FILE_ADDRESS_PREFIX = 'dsh-resource://file/';

/** 编码一段 id / 路径（`:` 保留字面量，给 Windows 盘符用） */
export function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/%3A/gi, ':');
}

/** 按段编码一条 `/` 分隔的路径 */
export function encodePath(path) {
  return path.split('/').map(encodeSegment).join('/');
}

/**
 * 一份会话作用域的文件地址。
 *
 * @param sessionId - 会话 id
 * @param path - 绝对或相对（相对工作区）路径；反斜杠归一成 `/`，开头的 `./` 去掉
 */
export function sessionFileAddress(sessionId, path) {
  const normalized = String(path).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
}

/** 是不是 Windows 盘符 / UNC 那种绝对路径 */
export function isWindowsStylePath(value) {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\');
}

/** 是不是绝对路径（POSIX 或 Windows 拼法） */
export function isAbsoluteWorkspacePath(path) {
  return path.startsWith('/') || isWindowsStylePath(path);
}

/**
 * 把一个路径变成"这份会话能打开"的地址：工作区内的绝对路径削成相对路径，
 * 工作区外的保留绝对路径（由文件提供方在会话里解析）。
 *
 * @param sessionId - 会话 id
 * @param cwd - 该会话的工作区根（未知就传 undefined）
 * @param path - 要打开的路径
 */
export function fileAddressFor(sessionId, cwd, path) {
  const normalized = String(path).replace(/\\/g, '/');
  if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
  const root = cwd === undefined || cwd === null ? '' : String(cwd).replace(/\\/g, '/').replace(/\/+$/, '');
  if (root !== '' && normalized === root) return sessionFileAddress(sessionId, '');
  if (root !== '' && normalized.startsWith(`${root}/`)) {
    return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
  }
  return sessionFileAddress(sessionId, normalized);
}

/**
 * 一帧「请打开这个文件」。
 *
 * @param input - `{ sessionId, cwd, path, line }`
 * @returns `{ type: 'reveal', address, path, line }`
 */
export function revealFrame(input) {
  const { sessionId, cwd, path, line } = input ?? {};
  if (typeof sessionId !== 'string' || sessionId === '') throw new Error('reveal：缺少会话 id');
  if (typeof path !== 'string' || path.trim() === '') throw new Error('reveal：缺少文件路径');
  return {
    type: 'reveal',
    address: fileAddressFor(sessionId, cwd, path),
    path,
    line: typeof line === 'number' && Number.isFinite(line) ? line : null,
  };
}

/** 一帧 SSE 数据 */
export function sseData(frame) {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

/** 只允许本机（维护用的测试口不给局域网用） */
export function isLoopback(request) {
  const address = request?.socket?.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
