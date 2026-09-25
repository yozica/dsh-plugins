import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PathTarget } from '../src/paths.js';
import { renderMarkdown, type H, type PathSource } from '../src/view.js';

interface Element {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: unknown[];
}

/** 假的 createElement：只记账，不需要 React */
const h: H = (type, props, ...children) => ({
  type: String(type),
  props: props ?? {},
  children,
});

function walk(node: unknown, visit: (element: Element) => void): void {
  if (node === null || typeof node !== 'object') return;
  const element = node as Element;
  if (typeof element.type !== 'string' || !Array.isArray(element.children)) return;
  visit(element);
  for (const child of element.children) walk(child, visit);
}

function findAll(tree: unknown, predicate: (element: Element) => boolean): Element[] {
  const found: Element[] = [];
  walk(tree, (element) => {
    if (predicate(element)) found.push(element);
  });
  return found;
}

function render(source: string): { tree: unknown; opened: [PathTarget, PathSource][] } {
  const opened: [PathTarget, PathSource][] = [];
  const tree = renderMarkdown(source, {
    h,
    onOpenPath: (target, from) => opened.push([target, from]),
  });
  return { tree, opened };
}

test('行内代码里的路径渲染成可点元素，并带行号', () => {
  const { tree } = render('看这个 `src/a.ts:12` 文件');
  const targets = findAll(tree, (element) => element.props['data-dsh-paths-target'] === 'src/a.ts');
  assert.equal(targets.length, 1);
  const target = targets[0] as Element;
  assert.equal(target.type, 'code');
  assert.equal(target.props['data-dsh-paths-line'], 12);
  assert.equal(target.props.role, 'link');
  assert.equal(target.props.tabIndex, 0);
  assert.equal(target.props.className, 'dsh-paths-target');
});

test('点击路径走 onOpenPath（行内代码 vs 链接两种来源）', () => {
  const { tree, opened } = render('`src/a.ts:12`');
  const target = findAll(tree, (element) => element.props.role === 'link')[0] as Element;
  const event = { preventDefault: () => {}, stopPropagation: () => {} };
  (target.props.onClick as (event: unknown) => void)(event);
  assert.deepEqual(opened, [[{ path: 'src/a.ts', line: 12 }, 'code']]);

  const link = render('[说明](docs/b.md)');
  const linkTarget = findAll(link.tree, (element) => element.props.role === 'link')[0] as Element;
  (linkTarget.props.onClick as (event: unknown) => void)({ preventDefault: () => {} });
  assert.deepEqual(link.opened, [[{ path: 'docs/b.md' }, 'link']]);
});

test('指路径的 Markdown 链接渲染成可点的 <a>，href 是 #（不给页面跳走的机会）', () => {
  const { tree } = render('[说明](docs/b.md)');
  const anchor = findAll(tree, (element) => element.type === 'a')[0] as Element;
  assert.equal(anchor.props.href, '#');
  assert.equal(anchor.props['data-dsh-paths-kind'], 'link');
  assert.equal(anchor.props['data-dsh-paths-target'], 'docs/b.md');
});

test('http(s) 链接走浏览器：target=_blank + rel', () => {
  const { tree } = render('[站点](https://example.com/a)');
  const anchor = findAll(tree, (element) => element.type === 'a')[0] as Element;
  assert.equal(anchor.props.href, 'https://example.com/a');
  assert.equal(anchor.props.target, '_blank');
  assert.equal(anchor.props.rel, 'noreferrer noopener');
  assert.equal(anchor.props['data-dsh-paths-target'], undefined);
});

test('认不出来的 href 不给点（渲染成 span，别让页面乱跳）', () => {
  const { tree } = render('[说明](whatever)');
  const span = findAll(tree, (element) => element.type === 'span')[0] as Element;
  assert.equal(span.props.className, 'dsh-paths-plain');
  assert.equal(findAll(tree, (element) => element.type === 'a').length, 0);
});

test('代码块里不识别路径（示例代码不该变链接）', () => {
  const { tree } = render('```\nconst p = "src/a.ts";\n```');
  assert.equal(
    findAll(tree, (element) => element.props['data-dsh-paths-target'] !== undefined).length,
    0,
  );
  assert.equal(findAll(tree, (element) => element.type === 'pre').length, 1);
});

test('结构化块：标题层级、表格、列表、引用都渲染出来', () => {
  const { tree } = render('## 二级\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- x\n\n> q\n');
  const types = findAll(tree, () => true).map((element) => element.type);
  assert.ok(types.includes('h2'));
  assert.ok(types.includes('table'));
  assert.ok(types.includes('thead'));
  assert.ok(types.includes('tbody'));
  assert.ok(types.includes('ul'));
  assert.ok(types.includes('blockquote'));
});
