/**
 * 路径识别与定位 —— **纯字符串逻辑**，不碰 DOM、不碰 React、不碰文件系统。
 *
 * 只认"明确写出来"的路径，不做裸文本猜测：
 *
 * | 来源                       | 认不认 | 说明                                              |
 * | -------------------------- | ------ | ------------------------------------------------- |
 * | 行内代码 `` `src/a.ts` ``  | ✅     | `classifyPathToken`（相对路径要求带扩展名）       |
 * | Markdown 链接指向路径      | ✅     | `classifyLinkPath`（比行内代码宽：`other.md` 也认）|
 * | `path:12` / `path#L12`     | ✅     | `splitLocation` 拆出行号（支持 `:line:col`）      |
 * | 代码块里的"像路径的东西"   | ❌     | 由 Markdown 解析器保证：代码块不当行内处理        |
 * | 正文里的裸路径词           | ❌     | 误报代价高（`a.com`、`and/or` 都会中）            |
 * | `http(s):` / `mailto:` 等  | ❌     | 走 `classifyHref` → 交给浏览器                    |
 *
 * @module @yozica/dsh-plugin-paths/paths
 */
import { isWindowsStylePath } from '@yozica/dsh-plugin-kit/client';

/** 一个可打开的文件目标 */
export interface PathTarget {
  /** 已把 `\` 归一成 `/` 的路径 */
  readonly path: string;
  /** 1-based 行号（`path:12` / `path#L12`） */
  readonly line?: number;
  /** 1-based 列号（`path:12:5`） */
  readonly column?: number;
}

/** 链接该去哪 */
export type LinkTarget =
  | { readonly kind: 'path'; readonly target: PathTarget }
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'anchor' }
  | { readonly kind: 'other' };

/** 带 scheme 的东西（`http:`、`file:`、`javascript:`…） */
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
/** 交给系统浏览器的 scheme（其余的 scheme 一律不给点） */
const EXTERNAL_SCHEME = /^(?:https?|mailto|tel|ftp|ftps):/i;
/** 结尾看起来像扩展名 */
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
/** 太长的"路径"多半不是路径（防止把一整段话变链接） */
const MAX_LENGTH = 400;

function isPlainPath(candidate: string): boolean {
  if (candidate.length === 0 || candidate.length > MAX_LENGTH) return false;
  if (candidate.includes('\0') || /\s/.test(candidate)) return false;
  if (candidate.startsWith('#') || candidate.startsWith('//')) return false;
  // 盘符（`C:/…`）先认下来：不然会被下面的 SCHEME 当成 `c:` 协议
  if (isWindowsStylePath(candidate)) return true;
  if (SCHEME.test(candidate)) return false;
  return true;
}

/**
 * 拆出结尾的行号 / 列号。
 *
 * 支持的写法：`a.ts:12`、`a.ts:12:5`、`a.ts#L12`、`a.ts#L12C5`。
 * 单字母的"路径部分"不拆（`C:12` 会被当成盘符拼法而不是行号）。
 */
export function splitLocation(value: string): PathTarget {
  const text = value.trim();
  const hash = /^(.*?)#L(\d+)(?:C(\d+))?$/i.exec(text);
  if (hash !== null && hash[1] !== undefined && hash[1] !== '') {
    return withLocation(hash[1], hash[2], hash[3]);
  }
  const colon = /^(.*?):(\d+)(?::(\d+))?$/.exec(text);
  if (colon !== null && colon[1] !== undefined && colon[1] !== '' && !/^[A-Za-z]$/.test(colon[1])) {
    return withLocation(colon[1], colon[2], colon[3]);
  }
  return { path: text.replace(/\\/g, '/') };
}

function withLocation(
  rawPath: string,
  rawLine: string | undefined,
  rawColumn: string | undefined,
): PathTarget {
  const line = rawLine === undefined ? undefined : Number(rawLine);
  const column = rawColumn === undefined ? undefined : Number(rawColumn);
  return {
    path: rawPath.replace(/\\/g, '/'),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}

/** 行内代码里那串东西，像不像一个路径 */
export function classifyPathToken(value: string): PathTarget | null {
  const target = splitLocation(value);
  const candidate = target.path;
  if (!isPlainPath(candidate)) return null;
  const shaped =
    candidate.startsWith('~/') ||
    candidate.startsWith('./') ||
    candidate.startsWith('../') ||
    isWindowsStylePath(candidate) ||
    candidate.startsWith('/') ||
    (candidate.includes('/') && EXTENSION.test(candidate));
  if (!shaped) return null;
  return target;
}

/**
 * Markdown 链接的 `href` 指向文件时，判定比行内代码宽一档：
 * `[说明](other.md)` 这种"裸文件名 + 扩展名"也算（链接语法本身就是明确意图）。
 */
export function classifyLinkPath(href: string): PathTarget | null {
  const strict = classifyPathToken(href);
  if (strict !== null) return strict;
  const target = splitLocation(href);
  const candidate = target.path;
  if (!isPlainPath(candidate)) return null;
  if (EXTENSION.test(candidate) || candidate.endsWith('/')) return target;
  return null;
}

/** 一个链接 href 该去哪 */
export function classifyHref(href: string): LinkTarget {
  const raw = href.trim();
  if (raw === '') return { kind: 'other' };
  if (raw.startsWith('#')) return { kind: 'anchor' };
  if (EXTERNAL_SCHEME.test(raw)) return { kind: 'external', url: raw };
  if (SCHEME.test(raw)) return { kind: 'other' };
  const target = classifyLinkPath(raw);
  return target === null ? { kind: 'other' } : { kind: 'path', target };
}

/** 取所在目录（不含末尾 `/`）；没有目录就返回空串。本身就是目录（末尾有 `/`）时返回它自己 */
export function dirOf(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const withoutTrailing = normalized.replace(/\/+$/, '');
  if (withoutTrailing !== normalized) return withoutTrailing; // `a/b/` 是目录，不是"a/b 这个文件"
  const slash = withoutTrailing.lastIndexOf('/');
  return slash < 0 ? '' : withoutTrailing.slice(0, slash);
}

/** 归一化 `/` 分隔路径里的 `.` 与 `..`（越界就保留在开头，交给宿主判定） */
export function normalizePath(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else if (segment === '..' && absolute) continue;
    else out.push(segment);
  }
  return `${absolute ? '/' : ''}${out.join('/')}`;
}

/** 相对路径的候选顺序：先"相对当前文件所在目录"，再"相对工作区根" */
export function relativeCandidates(filePath: string, relative: string): string[] {
  const dir = dirOf(filePath);
  const joined = normalizePath(dir === '' ? relative : `${dir}/${relative}`);
  const bare = normalizePath(relative);
  return joined === bare ? [joined] : [joined, bare];
}

/**
 * 给 HTML 桥脚本用的路径正则**源码**（文本节点里"把路径变可点"用）。
 *
 * 必须带至少一段 `/`（或绝对前缀）**并且**以扩展名收尾 —— 否则 `a.com`、`and/or`
 * 这种日常词会被包成链接。`:12` 行号可选。桥脚本在 iframe 里跑，没法 import，
 * 所以在这里生成一次、两边共用同一份。
 */
export const INLINE_PATH_PATTERN =
  String.raw`(?<![\w:/.\-])((?:~\/|\/|[A-Za-z]:[\\/]|\.{1,2}\/)[A-Za-z0-9_.@%+\-]+(?:\/[A-Za-z0-9_.@%+\-]+)*\.[A-Za-z0-9]{1,8}|` +
  String.raw`[A-Za-z0-9_.@%+\-]+(?:\/[A-Za-z0-9_.@%+\-]+)+\.[A-Za-z0-9]{1,8})(?::(\d+))?(?![\w/])`;
