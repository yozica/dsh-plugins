/**
 * HTML 预览的"打包 + 解码"部分（**浏览器里跑**：`DOMParser` / `atob` / `TextDecoder`）。
 *
 * 我们接管官方 html body，就得自己把相对 `script[src]` / `link[rel=stylesheet]` 读出来，
 * 连同 HTML 一起交给 iframe（资源 URL 必须在沙箱内创建，见 `bridge.ts`）。
 *
 * 这里是**尽力而为**，任何一步失败都只降级、不抛：
 * 资源读不到 → 那一份不打包（正文照常显示）；不是 UTF-8 文本 → 交给上层的错误兜底。
 *
 * @module @yozica/dsh-plugin-panel-body/html
 */

/** 一份资源的上限（与官方同量级，避免被一个巨型依赖拖死） */
const MAX_ASSET_CHARS = 4 * 1024 * 1024;
const MAX_ASSETS = 64;

/** 读取"相对当前文件的资源"（由 `browser.ts` 绑到 `ctx.remote.workspaceFiles.readRelated`） */
export type ReadRelated = (
  address: string,
  relativePath: string,
  signal: AbortSignal,
) => Promise<{ readonly text: string }>;

/** 解码一份完整 UTF-8 文本；非法字节会抛（交给上层兜底） */
export function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(data);
}

/** 解 `readRelated` 拿到的 base64 数据 */
export function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** 只有相对引用才由我们读；`http:`、`/abs`、`#`、`data:` 一律不动 */
function isRelativeReference(reference: string): boolean {
  return (
    reference.length > 0 &&
    !/^(?:[a-z][a-z\d+.-]*:|[/\\#?])/iu.test(reference) &&
    !reference.includes('\0')
  );
}

/**
 * 收集随 HTML 一起搬进 iframe 的静态资源（只认经典的相对 `.js` / `.css`）。
 *
 * 有 `<base href>` 时直接放弃（官方也这么做）：那时相对引用的基准由页面自己定，我们猜不准。
 */
export async function packAssets(
  html: string,
  address: string,
  readRelated: ReadRelated | undefined,
  signal: AbortSignal | undefined,
): Promise<{ kind: 'script' | 'stylesheet'; reference: string; text: string }[]> {
  if (readRelated === undefined || typeof DOMParser === 'undefined') return [];
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  if (parsed.querySelector('base[href]') !== null) return [];

  const assets: { kind: 'script' | 'stylesheet'; reference: string; text: string }[] = [];
  const seen = new Set<string>();

  for (const element of Array.from(parsed.querySelectorAll('script[src],link[href]'))) {
    const script = element.localName === 'script';
    const type = (element.getAttribute('type') ?? '').trim().toLowerCase();
    if (script && !['', 'text/javascript', 'application/javascript'].includes(type)) continue;
    if (
      !script &&
      !(element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/u).includes('stylesheet')
    ) {
      continue;
    }

    const reference = element.getAttribute(script ? 'src' : 'href') ?? '';
    const suffix = reference.search(/[?#]/u);
    const path = suffix === -1 ? reference : reference.slice(0, suffix);
    if (!isRelativeReference(reference)) continue;
    if (!(script ? /\.js$/iu : /\.css$/iu).test(path)) continue;

    const kind = script ? 'script' : 'stylesheet';
    const key = `${kind}:${reference}`;
    if (seen.has(key)) continue;
    if (assets.length >= MAX_ASSETS) break;

    try {
      signal?.throwIfAborted?.();
      const asset = await readRelated(address, reference, signal ?? new AbortController().signal);
      signal?.throwIfAborted?.();
      if (asset.text.length > MAX_ASSET_CHARS) continue;
      assets.push({ kind, reference, text: asset.text });
      seen.add(key);
    } catch {
      // 单个依赖读不到不值得毁掉整份预览
    }
  }

  return assets;
}
