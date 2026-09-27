import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'node:test';

import { BRIDGE_SOURCE, frameDocument } from '../src/bridge.js';

function scriptBody(document: string): string {
  const start = document.indexOf('<script>');
  const end = document.lastIndexOf('</script>');
  return document.slice(start + '<script>'.length, end);
}

test('srcdoc：正文里的 </script> 不会截断引导脚本，脚本本身语法正确', () => {
  const html = '<p>a</p></script><script>alert(1)</script>';
  const document = frameDocument(html, []);
  assert.ok(!document.includes('</script><script>alert'), '原始内容不能原样出现');
  assert.ok(document.includes('\\u003c/script'), '< 要转义成 \\u003c');
  assert.doesNotThrow(() => new vm.Script(scriptBody(document)), '转义不能把引导脚本写坏');
});

test('srcdoc：带桥标记、路径包裹、资源 blob 重写', () => {
  const document = frameDocument('<link rel="stylesheet" href="a.css">', [
    { kind: 'stylesheet', reference: 'a.css', text: 'body{color:red}' },
  ]);
  assert.ok(document.includes(BRIDGE_SOURCE));
  assert.ok(document.includes('data-dsh-panel-body-reveal'));
  assert.ok(document.includes('URL.createObjectURL'));
  assert.ok(document.includes('body{color:red}'));
  assert.ok(document.includes('MutationObserver'));
  assert.doesNotThrow(() => new vm.Script(scriptBody(document)));
});

test('srcdoc：没有资源时 assets 为空数组、脚本仍可解析', () => {
  const document = frameDocument('<p>x</p>', []);
  assert.ok(document.includes('"assets":[]'));
  assert.doesNotThrow(() => new vm.Script(scriptBody(document)));
});
