/**
 * 薄 Markdown 解析器 —— **故意只够用**：标题 / 段落 / 围栏代码 / 列表 / 引用 / 表格 / 分隔线，
 * 行内支持代码、强调、链接、自动链接。
 *
 * 为什么自己写而不是引库：这个包的 client 半边要打进 DSH 的页面，**没有任何运行时依赖**
 * （React 由宿主提供）；而且我们只需要渲染 + 认出路径两件事，不需要 sanitize / 脚注 / 数学公式。
 *
 * 两台"降级"是明确的（README 里也写了）：
 *
 * - **缩进式代码块（4 空格）不识别**：只认围栏代码块。缩进代码在内嵌文档里少见，
 *   而识别它容易把列表续行误判成代码。
 * - **围栏跨页**：`text-pages` 模式下 `content.text` 可能是"还没读完"的前缀。
 *   没闭合的围栏按"后面都是代码"处理（很长的代码块也不会渲染成半截正文）。
 *
 * @module @yozica/dsh-plugin-paths/markdown
 */

/** 行内节点 */
export type Inline =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'code'; readonly value: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'em'; readonly children: readonly Inline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] };

/** 块级节点 */
export type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly children: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly children: readonly Inline[] }
  | { readonly kind: 'code'; readonly lang: string; readonly value: string }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly start: number;
      readonly items: readonly (readonly Inline[])[];
    }
  | { readonly kind: 'quote'; readonly children: readonly Inline[] }
  | {
      readonly kind: 'table';
      readonly header: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    }
  | { readonly kind: 'hr' };

const LIST_ITEM = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]*-[\s:|-]*\|?[\s:|-]*$/;

/** 解析一段 Markdown 源码 */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? '```';
      const closing = new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`);
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !closing.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1; // 跳过闭合围栏
      blocks.push({ kind: 'code', lang: langOf(fence[2] ?? ''), value: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        children: parseInline(heading[2] ?? ''),
      });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'hr' });
      index += 1;
      continue;
    }

    const table = readTable(lines, index);
    if (table !== null) {
      blocks.push(table.block);
      index = table.next;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index] ?? '')) {
        body.push((lines[index] ?? '').replace(QUOTE, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', children: parseInline(body.join(' ').trim()) });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const start = ordered ? Number.parseInt(line.trim(), 10) : 1;
      const items: Inline[][] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const item = LIST_ITEM.exec(current);
        if (item !== null) {
          items.push(parseInline((item[4] ?? '').trim()));
          index += 1;
          continue;
        }
        // 续行：缩进且不是空行 → 并进上一项（当成同一段的文字）
        if (items.length > 0 && current.trim() !== '' && /^\s{2,}\S/.test(current)) {
          items[items.length - 1]?.push({ kind: 'text', value: ` ${current.trim()}` });
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({
        kind: 'list',
        ordered,
        start: Number.isFinite(start) ? start : 1,
        items,
      });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim() === '') break;
      if (
        FENCE.test(current) ||
        HEADING.test(current) ||
        RULE.test(current) ||
        QUOTE.test(current) ||
        LIST_ITEM.test(current)
      ) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join('\n')) });
    }
  }

  return blocks;
}

function langOf(info: string): string {
  const first = info.trim().split(/\s+/)[0] ?? '';
  return first.replace(/[^\w+#.-]/g, '');
}

function splitRow(row: string): Inline[][] {
  const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => parseInline(cell.trim()));
}

function readTable(
  lines: readonly string[],
  start: number,
): { block: Extract<Block, { kind: 'table' }>; next: number } | null {
  const header = lines[start] ?? '';
  const separator = lines[start + 1] ?? '';
  if (!header.includes('|') || !TABLE_SEPARATOR.test(separator) || !separator.includes('-')) {
    return null;
  }
  const rows: Inline[][][] = [];
  let index = start + 2;
  while (index < lines.length) {
    const row = lines[index] ?? '';
    if (row.trim() === '' || !row.includes('|')) break;
    rows.push(splitRow(row));
    index += 1;
  }
  return { block: { kind: 'table', header: splitRow(header), rows }, next: index };
}

/** 解析一行/一段里的行内节点 */
export function parseInline(source: string): Inline[] {
  const nodes: Inline[] = [];
  let buffer = '';
  let index = 0;

  const flush = (): void => {
    if (buffer !== '') nodes.push({ kind: 'text', value: buffer });
    buffer = '';
  };

  while (index < source.length) {
    const char = source[index] ?? '';

    if (char === '\\' && index + 1 < source.length) {
      buffer += source[index + 1] ?? '';
      index += 2;
      continue;
    }

    if (char === '`') {
      const mark = /^`+/.exec(source.slice(index))?.[0] ?? '`';
      const close = source.indexOf(mark, index + mark.length);
      if (close > index) {
        flush();
        nodes.push({ kind: 'code', value: source.slice(index + mark.length, close).trim() });
        index = close + mark.length;
        continue;
      }
    }

    if (char === '[') {
      const link = matchLink(source, index);
      if (link !== null) {
        flush();
        nodes.push({ kind: 'link', href: link.href, children: parseInline(link.label) });
        index = link.end;
        continue;
      }
    }

    if (char === '<') {
      const autolink = /^<([a-z][^\s<>]*)>/i.exec(source.slice(index));
      const url = autolink?.[1];
      if (url !== undefined && /^(?:https?|mailto):/i.test(url)) {
        flush();
        nodes.push({ kind: 'link', href: url, children: [{ kind: 'text', value: url }] });
        index += autolink?.[0].length ?? 0;
        continue;
      }
    }

    if (source.startsWith('**', index) || source.startsWith('__', index)) {
      const mark = source.slice(index, index + 2);
      const close = source.indexOf(mark, index + 2);
      if (close > index + 2) {
        flush();
        nodes.push({ kind: 'strong', children: parseInline(source.slice(index + 2, close)) });
        index = close + 2;
        continue;
      }
    }

    if (char === '*' || char === '_') {
      const close = source.indexOf(char, index + 1);
      if (close > index + 1) {
        flush();
        nodes.push({ kind: 'em', children: parseInline(source.slice(index + 1, close)) });
        index = close + 1;
        continue;
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
  return nodes;
}

function matchLink(
  source: string,
  start: number,
): { label: string; href: string; end: number } | null {
  // 只认 `[label](href)`；引用式 `[label][ref]` 不当链接（渲染成普通文字，不误导）
  const close = source.indexOf(']', start + 1);
  if (close < 0 || source[close + 1] !== '(') return null;
  const end = source.indexOf(')', close + 2);
  if (end < 0) return null;
  const label = source.slice(start + 1, close);
  const raw = source.slice(close + 2, end).trim();
  const href = raw.replace(/\s+(?:"[^"]*"|'[^']*')$/, '').trim();
  return { label, href, end: end + 1 };
}
