import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseInline, parseMarkdown, type Block } from '../src/markdown.js';

test('块级：标题 / 段落 / 围栏代码 / 列表 / 引用 / 分隔线 / 表格', () => {
  const source = [
    '# 标题',
    '',
    '一段话，含 `src/a.ts`。',
    '',
    '```ts',
    'const x = 1; // src/example.ts 不该变成链接',
    '```',
    '',
    '- 第一项',
    '- 第二项',
    '',
    '1. 有序一',
    '2. 有序二',
    '',
    '> 引用一行',
    '',
    '---',
    '',
    '| 列 A | 列 B |',
    '| ---- | ---- |',
    '| a1   | b1   |',
  ].join('\n');

  const kinds = parseMarkdown(source).map((block) => block.kind);
  assert.deepEqual(kinds, ['heading', 'paragraph', 'code', 'list', 'list', 'quote', 'hr', 'table']);

  const code = parseMarkdown(source).find((block) => block.kind === 'code') as Extract<
    Block,
    { kind: 'code' }
  >;
  assert.equal(code.lang, 'ts');
  assert.equal(code.value, 'const x = 1; // src/example.ts 不该变成链接');

  const tables = parseMarkdown(source).filter((block) => block.kind === 'table');
  assert.equal(tables.length, 1);
});

test('围栏没闭合：后面全部当代码（分页读到一半也不会渲染半截正文）', () => {
  const blocks = parseMarkdown('```\nline1\nline2');
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], { kind: 'code', lang: '', value: 'line1\nline2' });
});

test('有序列表的起始序号保留', () => {
  const list = parseMarkdown('3. 三\n4. 四')[0];
  assert.equal(list?.kind, 'list');
  assert.equal(list?.kind === 'list' ? list.start : 0, 3);
  assert.equal(list?.kind === 'list' ? list.items.length : 0, 2);
});

test('行内：代码 / 强调 / 链接 / 自动链接；代码里的路径仍是 code 节点（识别交给 view）', () => {
  assert.deepEqual(parseInline('`src/a.ts`'), [{ kind: 'code', value: 'src/a.ts' }]);
  assert.deepEqual(parseInline('**粗**'), [
    { kind: 'strong', children: [{ kind: 'text', value: '粗' }] },
  ]);
  assert.deepEqual(parseInline('*斜*'), [
    { kind: 'em', children: [{ kind: 'text', value: '斜' }] },
  ]);
  assert.deepEqual(parseInline('[说明](docs/a.md "标题")'), [
    { kind: 'link', href: 'docs/a.md', children: [{ kind: 'text', value: '说明' }] },
  ]);
  assert.deepEqual(parseInline('<https://x.dev/a>'), [
    {
      kind: 'link',
      href: 'https://x.dev/a',
      children: [{ kind: 'text', value: 'https://x.dev/a' }],
    },
  ]);
  // 引用式链接不认（渲染成普通文字，别乱跳）
  assert.deepEqual(parseInline('[说明][ref]'), [{ kind: 'text', value: '[说明][ref]' }]);
});

test('反斜杠转义与未闭合标记不吞字符', () => {
  assert.deepEqual(parseInline('\\*不是斜体\\*'), [{ kind: 'text', value: '*不是斜体*' }]);
  assert.deepEqual(parseInline('一个 ` 没闭合'), [{ kind: 'text', value: '一个 ` 没闭合' }]);
  assert.deepEqual(parseInline('a ** b'), [{ kind: 'text', value: 'a ** b' }]);
});
