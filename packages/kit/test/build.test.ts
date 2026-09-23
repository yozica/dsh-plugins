import assert from 'node:assert/strict';
import { test } from 'node:test';

import { wrapClient } from '../src/build.js';

test('wrapClient：包成宿主认得的 loader 形状，代码整体缩进', () => {
  const out = wrapClient(
    '@yozica/dsh-plugin-demo',
    'exports.name = "demo";\nexports.apply = function () {};',
  );
  assert.match(out, /window\.__ModuleLoader__\.load\(\{/);
  assert.match(out, /id: "@yozica\/dsh-plugin-demo"/);
  assert.match(out, /factory: \(require\) => \{/);
  assert.match(out, /var module = \{ exports: \{\} \};/);
  assert.match(out, /exports\.name = "demo";/);
  assert.match(out, /return module\.exports;/);
  // 代码必须在 factory 里（缩进），不是散在文件顶层
  assert.match(out, /^ {4}exports\.name = "demo";$/m);
});
