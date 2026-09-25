import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyHref,
  classifyLinkPath,
  classifyPathToken,
  dirOf,
  normalizePath,
  relativeCandidates,
  splitLocation,
} from '../src/paths.js';

test('行内代码：相对路径要带扩展名（避免 `and/or`、`a.ts` 误报）', () => {
  assert.deepEqual(classifyPathToken('src/a.ts'), { path: 'src/a.ts' });
  assert.deepEqual(classifyPathToken('./a.ts'), { path: './a.ts' });
  assert.deepEqual(classifyPathToken('../a.ts'), { path: '../a.ts' });
  assert.deepEqual(classifyPathToken('/Users/me/a.ts'), { path: '/Users/me/a.ts' });
  assert.deepEqual(classifyPathToken('~/notes/a.md'), { path: '~/notes/a.md' });
  assert.deepEqual(classifyPathToken('C:\\proj\\a.ts'), { path: 'C:/proj/a.ts' });
  assert.deepEqual(classifyPathToken('docs/guide.md'), { path: 'docs/guide.md' });

  // 裸文件名：扩展名在白名单里就认（`index.ts:30` 很常见），不在就拒（防 process.env 这类）
  assert.deepEqual(classifyPathToken('a.ts'), { path: 'a.ts' });
  assert.deepEqual(classifyPathToken('paths-demo.html'), { path: 'paths-demo.html' });
  assert.deepEqual(classifyPathToken('plug.ts:30'), { path: 'plug.ts', line: 30 });
  assert.equal(classifyPathToken('process.env'), null, '属性名不是路径');
  assert.equal(classifyPathToken('console.log'), null);
  assert.equal(classifyPathToken('React.Component'), null);
  assert.equal(classifyPathToken('Math.max'), null);
  assert.equal(classifyPathToken('1.5'), null);
  assert.equal(classifyPathToken('arr.map'), null);
  assert.equal(classifyPathToken('this.key'), null);
  assert.equal(classifyPathToken('docs/guide'), null, '没有扩展名的相对路径不认');
  assert.equal(classifyPathToken('const x = 1'), null);
  assert.equal(classifyPathToken('and/or'), null);
  assert.equal(classifyPathToken('src/a b.ts'), null, '带空格不认（已知限制）');
  assert.equal(classifyPathToken('http://x/a.ts'), null);
  assert.equal(classifyPathToken('file:///a.ts'), null);
  assert.equal(classifyPathToken('#section'), null);
  assert.equal(classifyPathToken('//cdn.example.com/a.js'), null);
  assert.equal(classifyPathToken('C:12'), null);
  assert.equal(classifyPathToken(''), null);
});

test('行号：`:12`、`:12:5`、`#L12` 都拆出来；单字母不拆（盘符）', () => {
  assert.deepEqual(splitLocation('src/a.ts:12'), { path: 'src/a.ts', line: 12 });
  assert.deepEqual(splitLocation('src/a.ts:12:5'), { path: 'src/a.ts', line: 12, column: 5 });
  assert.deepEqual(splitLocation('src/a.ts#L12'), { path: 'src/a.ts', line: 12 });
  assert.deepEqual(splitLocation('src/a.ts#L12C5'), { path: 'src/a.ts', line: 12, column: 5 });
  assert.deepEqual(classifyPathToken('src/a.ts:12'), { path: 'src/a.ts', line: 12 });
  assert.deepEqual(classifyPathToken('C:\\x\\a.ts:12'), { path: 'C:/x/a.ts', line: 12 });
  assert.deepEqual(splitLocation('C:12'), { path: 'C:12' });
  assert.deepEqual(splitLocation('src/a.ts'), { path: 'src/a.ts' });
});

test('Markdown 链接：裸文件名 + 扩展名也认（链接语法本身就是明确意图）', () => {
  assert.deepEqual(classifyLinkPath('other.md'), { path: 'other.md' });
  assert.deepEqual(classifyLinkPath('sub/other.md'), { path: 'sub/other.md' });
  assert.deepEqual(classifyLinkPath('other.md:7'), { path: 'other.md', line: 7 });
  assert.deepEqual(classifyLinkPath('../up/'), { path: '../up/' });
  assert.equal(classifyLinkPath('https://x/y.md'), null);
  assert.equal(classifyLinkPath('README'), null);
});

test('href 分类：路径 / 外链 / 锚点 / 其它', () => {
  assert.deepEqual(classifyHref('https://example.com/a'), {
    kind: 'external',
    url: 'https://example.com/a',
  });
  assert.deepEqual(classifyHref('mailto:a@b.c'), { kind: 'external', url: 'mailto:a@b.c' });
  assert.deepEqual(classifyHref('#top'), { kind: 'anchor' });
  assert.deepEqual(classifyHref('src/a.ts:3'), {
    kind: 'path',
    target: { path: 'src/a.ts', line: 3 },
  });
  assert.deepEqual(classifyHref('sub/other.md'), {
    kind: 'path',
    target: { path: 'sub/other.md' },
  });
  assert.deepEqual(classifyHref('javascript:alert(1)'), { kind: 'other' });
  assert.deepEqual(classifyHref(''), { kind: 'other' });
});

test('路径工具：目录、归一化、候选顺序', () => {
  assert.equal(dirOf('/a/b/c.ts'), '/a/b');
  assert.equal(dirOf('c.ts'), '');
  assert.equal(dirOf('a/b/'), 'a/b');
  assert.equal(normalizePath('a/./b/../c'), 'a/c');
  assert.equal(normalizePath('/a/../..'), '/');
  assert.equal(normalizePath('../x.md'), '../x.md');
  assert.deepEqual(relativeCandidates('docs/a.md', 'img/b.png'), ['docs/img/b.png', 'img/b.png']);
  assert.deepEqual(relativeCandidates('a.md', 'b.md'), ['b.md']);
  assert.deepEqual(relativeCandidates('docs/a.md', '../x.md'), ['x.md', '../x.md']);
});
