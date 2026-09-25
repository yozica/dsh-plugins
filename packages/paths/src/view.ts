/**
 * AST → 元素树。**不 import React**：`createElement` 由调用方注入（`browser.ts` 传宿主的 React，
 * 测试传一个假的 `h`），这样渲染逻辑能在 Node 里断言，也避免为了一个探针把 React 拖进单测。
 *
 * @module @yozica/dsh-plugin-paths/view
 */
import { parseMarkdown, type Block, type Inline } from './markdown.js';
import { classifyHref, classifyPathToken, type PathTarget } from './paths.js';
import { STRINGS } from './strings.js';

/** `createElement` 的最小形状 */
export type H = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
) => unknown;

/** 路径从哪来（决定了渲染成 `<code>` 还是 `<a>`） */
export type PathSource = 'code' | 'link' | 'html';

export interface ViewDeps {
  readonly h: H;
  /** 点了路径：交给外层解析地址并打开 */
  readonly onOpenPath: (target: PathTarget, source: PathSource) => void;
}

/** 渲染一份 Markdown 源码 */
export function renderMarkdown(source: string, deps: ViewDeps): unknown {
  const blocks = parseMarkdown(source);
  return deps.h(
    'div',
    { className: 'dsh-paths-document', 'data-dsh-paths-document': true },
    ...blocks.map((block, index) => renderBlock(block, deps, `b${index}`)),
  );
}

function renderBlock(block: Block, deps: ViewDeps, key: string): unknown {
  switch (block.kind) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, block.level));
      return deps.h(`h${level}`, { key }, ...renderInline(block.children, deps, key));
    }
    case 'paragraph':
      return deps.h('p', { key }, ...renderInline(block.children, deps, key));
    case 'code':
      return deps.h(
        'pre',
        { key, className: 'dsh-paths-pre', 'data-dsh-paths-code': true },
        deps.h(
          'code',
          block.lang === '' ? null : { className: `language-${block.lang}` },
          block.value,
        ),
      );
    case 'list': {
      const items = block.items.map((item, index) =>
        deps.h('li', { key: `${key}i${index}` }, ...renderInline(item, deps, `${key}i${index}`)),
      );
      const props: Record<string, unknown> =
        block.ordered && block.start !== 1 ? { key, start: block.start } : { key };
      return deps.h(block.ordered ? 'ol' : 'ul', props, ...items);
    }
    case 'quote':
      return deps.h(
        'blockquote',
        { key },
        deps.h('p', null, ...renderInline(block.children, deps, key)),
      );
    case 'table': {
      const head = deps.h(
        'thead',
        null,
        deps.h(
          'tr',
          null,
          ...block.header.map((cell, index) =>
            deps.h(
              'th',
              { key: `${key}h${index}` },
              ...renderInline(cell, deps, `${key}h${index}`),
            ),
          ),
        ),
      );
      const body = deps.h(
        'tbody',
        null,
        ...block.rows.map((row, rowIndex) =>
          deps.h(
            'tr',
            { key: `${key}r${rowIndex}` },
            ...row.map((cell, cellIndex) =>
              deps.h(
                'td',
                { key: `${key}r${rowIndex}c${cellIndex}` },
                ...renderInline(cell, deps, `${key}r${rowIndex}c${cellIndex}`),
              ),
            ),
          ),
        ),
      );
      return deps.h('table', { key, className: 'dsh-paths-table' }, head, body);
    }
    case 'hr':
      return deps.h('hr', { key });
  }
}

function renderInline(nodes: readonly Inline[], deps: ViewDeps, keyPrefix: string): unknown[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.kind) {
      case 'text':
        return node.value;
      case 'code': {
        const target = classifyPathToken(node.value);
        if (target !== null) return pathElement(deps, target, 'code', key, node.value);
        return deps.h('code', { key, className: 'dsh-paths-code' }, node.value);
      }
      case 'strong':
        return deps.h('strong', { key }, ...renderInline(node.children, deps, `${key}s`));
      case 'em':
        return deps.h('em', { key }, ...renderInline(node.children, deps, `${key}e`));
      case 'link': {
        const children = renderInline(node.children, deps, `${key}l`);
        const target = classifyHref(node.href);
        if (target.kind === 'path') return pathElement(deps, target.target, 'link', key, children);
        if (target.kind === 'external') {
          return deps.h(
            'a',
            {
              key,
              className: 'dsh-paths-external',
              href: target.url,
              target: '_blank',
              rel: 'noreferrer noopener',
            },
            ...children,
          );
        }
        if (target.kind === 'anchor') return deps.h('a', { key, href: node.href }, ...children);
        // 认不出来的 href（含指向不存在路径的写法）不给点：渲染成普通文字，别让页面乱跳
        return deps.h('span', { key, className: 'dsh-paths-plain' }, ...children);
      }
    }
  });
}

/**
 * 一个可点的路径元素。
 *
 * 行内代码渲染成 `<code role="link" tabindex="0">`，指向路径的链接渲染成**没有 `href`** 的 `<a>`
 * （`role="link"` + `tabindex` + 键盘 Enter/Space；点击一律走侧栏）。
 *
 * 为什么不给 `<a>` 一个 `href="#"`：没有 `href` 时 cmd/中键点击不会触发"新窗口"请求 ——
 * 有 `href` 的话壳的 window-open 处理器会把 `#` 解析成应用自身 URL 并用**系统浏览器**打开，
 * 用户会莫名其妙多出一个标签页。官方渲染器的文件提及也是个 `<button>`，同样没有 `href`。
 *
 * `data-dsh-paths-*` 给 e2e 与真机核对用。
 */
function pathElement(
  deps: ViewDeps,
  target: PathTarget,
  source: PathSource,
  key: string,
  children: unknown,
): unknown {
  const open = (event: unknown): void => {
    const event_ = event as { preventDefault?: () => void; stopPropagation?: () => void } | null;
    event_?.preventDefault?.();
    event_?.stopPropagation?.();
    deps.onOpenPath(target, source);
  };
  const onKeyDown = (event: unknown): void => {
    const key_ = (event as { key?: string } | null)?.key;
    if (key_ === 'Enter' || key_ === ' ') open(event);
  };
  const props: Record<string, unknown> = {
    key,
    className: 'dsh-paths-target',
    role: 'link',
    tabIndex: 0,
    'data-dsh-paths-kind': source,
    'data-dsh-paths-target': target.path,
    title: STRINGS.openPathTitle(target.path, target.line),
    onClick: open,
    onKeyDown,
  };
  if (target.line !== undefined) props['data-dsh-paths-line'] = target.line;
  if (source === 'code') return deps.h('code', props, children);
  return deps.h('a', props, children);
}
