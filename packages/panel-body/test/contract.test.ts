import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PathsContext } from '../src/host.js';
import type { PathTarget } from '../src/paths.js';
import { registerBodies, type BodyProps, type PathOrigin } from '../src/plug.js';
import type { H } from '../src/view.js';

interface Element {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: unknown[];
}

const h: H = (type, props, ...children) => ({
  type: String(type),
  props: props ?? {},
  children,
});

function findElement(tree: unknown, predicate: (element: Element) => boolean): Element | null {
  if (tree === null || typeof tree !== 'object') return null;
  const element = tree as Element;
  if (typeof element.type !== 'string' || !Array.isArray(element.children)) return null;
  if (predicate(element)) return element;
  for (const child of element.children) {
    const found = findElement(child, predicate);
    if (found !== null) return found;
  }
  return null;
}

interface Injection {
  readonly name: string;
  readonly callback: () => unknown;
}

interface Registration {
  readonly target: {
    readonly name: string;
    readonly key: string;
    readonly inject?: () => unknown;
  };
  readonly component: (props: BodyProps) => unknown;
}

function setup(
  onOpenPath: (target: PathTarget, origin: PathOrigin) => void = () => {},
  options: { guard?: (child: unknown, fallback: unknown) => unknown; h?: H } = {},
): {
  definitions: Record<string, unknown>[];
  injections: Injection[];
  registrations: Registration[];
  readRelated: unknown;
  hCalls: () => number;
} {
  const definitions: Record<string, unknown>[] = [];
  const injections: Injection[] = [];
  const registrations: Registration[] = [];
  const ctx = {
    documentPreviews: {
      register: (definition: Record<string, unknown>) => {
        definitions.push(definition);
        return () => {};
      },
    },
    slots: {
      inject: (name: string, callback: () => unknown) => {
        injections.push({ name, callback });
        return () => {};
      },
      register: (target: Registration['target'], component: unknown) => {
        registrations.push({ target, component: component as Registration['component'] });
        return () => {};
      },
    },
    // 包契约里注册一律走 effect（卸载时收回）；假的这里直接执行
    effect: (run: () => unknown) => {
      run();
      return () => {};
    },
  } as unknown as PathsContext;

  const readRelated = async (): Promise<{ text: string }> => ({ text: 'body{}' });

  // 假的 h：记调用次数，用来验证"同一份正文只解析一次"
  let hCalls = 0;
  const countingH: H = (type, props, ...children) => {
    hCalls += 1;
    return (options.h ?? h)(type, props, ...children);
  };

  // 假的 useMemo：语义与 React 一致（依赖逐项 Object.is）——这样"依赖不稳定"会被测出来
  let memoDeps: readonly unknown[] | null = null;
  let memoValue: unknown = undefined;
  const useMemo = <T>(factory: () => T, deps: readonly unknown[]): T => {
    const hit =
      memoDeps !== null &&
      memoDeps.length === deps.length &&
      memoDeps.every((value, index) => Object.is(value, deps[index]));
    if (!hit) {
      memoValue = factory();
      memoDeps = deps;
    }
    return memoValue as T;
  };

  registerBodies(ctx, {
    h: countingH,
    hooks: {
      useState: <T>(initial: T): [T, (next: T | ((previous: T) => T)) => void] => [
        initial,
        () => {},
      ],
      useEffect: () => {},
      useRef: <T>(initial: T): { current: T } => ({ current: initial }),
      useMemo,
    },
    readRelated,
    onOpenPath,
    onExternal: () => {},
    ...(options.guard === undefined ? {} : { guard: options.guard }),
  });
  for (const injection of injections) injection.callback();
  return { definitions, injections, registrations, readRelated, hCalls: () => hCalls };
}

test('契约：定义形状（缺 loading / 或多注册父槽位都会被这里拦住）', () => {
  const { definitions, injections, registrations } = setup();
  assert.deepEqual(
    definitions.map((definition) => definition['id']),
    ['plugin-panel-body:md', 'plugin-panel-body:html'],
  );
  const [markdown, html] = definitions as [Record<string, unknown>, Record<string, unknown>];
  assert.deepEqual(markdown['extensions'], ['md', 'markdown']);
  assert.equal(markdown['loading'], 'text-pages');
  assert.equal(markdown['priority'], 'extension');
  assert.equal(markdown['wrap'], false);
  assert.deepEqual(html['extensions'], ['html', 'htm']);
  assert.equal(html['loading'], 'bytes-complete');
  assert.equal(html['priority'], 'extension');

  // 只 inject 子槽位
  assert.deepEqual(
    injections.map((injection) => injection.name),
    ['sidebar.right.tab.document', 'sidebar.right.tab.document'],
  );
  // 子槽位 key 必须与 body 定义的 id 一致（官方用 entryKey = selected.id 派发）
  assert.deepEqual(
    registrations.map((registration) => registration.target.key),
    ['plugin-panel-body:md', 'plugin-panel-body:html'],
  );
  assert.ok(
    registrations.every(
      (registration) => registration.target.name === 'sidebar.right.tab.document',
    ),
  );
  // 父槽位由官方按 tab 种类注册，我们绝不该碰
  assert.ok(
    !JSON.stringify(registrations.map((registration) => registration.target)).includes('pane.tab'),
  );
});

test('契约：Markdown body 渲染可点路径，点击带上当前文件地址', () => {
  const opened: [PathTarget, PathOrigin][] = [];
  const { registrations } = setup((target, origin) => opened.push([target, origin]));
  const markdown = registrations.find(
    (registration) => registration.target.key === 'plugin-panel-body:md',
  );
  assert.ok(markdown !== undefined);

  const tree = markdown.component({
    resourceAddress: 'dsh-resource://file/session/s1/docs/readme.md',
    content: { kind: 'text', text: '看 `src/a.ts:7` 这个文件' },
  });
  const target = findElement(
    tree,
    (element) => element.props['data-dsh-paths-target'] === 'src/a.ts',
  );
  assert.ok(target !== null);
  (target.props.onClick as (event: unknown) => void)({ preventDefault: () => {} });
  assert.deepEqual(opened, [
    [
      { path: 'src/a.ts', line: 7 },
      { resourceAddress: 'dsh-resource://file/session/s1/docs/readme.md', source: 'code' },
    ],
  ]);
});

test('契约：Markdown 没拿到文本时也不炸（渲染空文档）', () => {
  const { registrations } = setup();
  const markdown = registrations.find(
    (registration) => registration.target.key === 'plugin-panel-body:md',
  );
  assert.ok(markdown !== undefined);
  assert.doesNotThrow(() =>
    markdown.component({ content: { kind: 'bytes', data: new Uint8Array() } }),
  );
  assert.doesNotThrow(() => markdown.component({}));
});

test('契约：只有 HTML 那个注册带 readRelated 注入，Markdown 不带', () => {
  const { registrations, readRelated } = setup();
  const markdown = registrations.find(
    (registration) => registration.target.key === 'plugin-panel-body:md',
  );
  const html = registrations.find(
    (registration) => registration.target.key === 'plugin-panel-body:html',
  );
  assert.ok(markdown !== undefined && html !== undefined);
  assert.equal(markdown.target.inject, undefined);
  assert.deepEqual(html.target.inject?.(), { readRelated });
});

test('契约：同一份正文重复渲染只解析一次（useMemo 依赖必须稳定）', () => {
  const { registrations, hCalls } = setup();
  const markdown = registrations.find(
    (registration) => registration.target.key === 'plugin-panel-body:md',
  );
  assert.ok(markdown !== undefined);
  const props = {
    resourceAddress: 'dsh-resource://file/session/s1/docs/readme.md',
    content: { kind: 'text' as const, text: '# 标题\n\n看 `src/a.ts`' },
  };
  const first = markdown.component(props);
  const afterFirst = hCalls();
  assert.ok(afterFirst > 1, '第一次要真的建树');
  // 父组件每次滚动都会重渲染我们；同一份正文不该再解析/建树一次
  const second = markdown.component(props);
  assert.equal(hCalls(), afterFirst, '第二次渲染不该再调用 createElement（memo 命中）');
  assert.equal(second, first, '返回同一棵树（React 才能跳过整棵子树的重建）');
});

test('契约：guard（错误边界）会包住我们返回的树', () => {
  const seen: { child: unknown; fallback: unknown }[] = [];
  const { registrations } = setup(() => {}, {
    guard: (child, fallback) => {
      seen.push({ child, fallback });
      return { type: 'boundary', child, fallback };
    },
  });
  const markdown = registrations.find(
    (registration) => registration.target.key === 'plugin-panel-body:md',
  );
  assert.ok(markdown !== undefined);
  const tree = markdown.component({ content: { kind: 'text', text: '正文' } });
  assert.deepEqual(Object.keys(tree as object).sort(), ['child', 'fallback', 'type']);
  assert.equal(seen.length, 1);
  // fallback 是"原文 <pre>"：渲染崩了就退回它，而不是白屏
  assert.equal((seen[0]?.fallback as Element).props['data-dsh-paths-fallback'], true);
});

test('契约：渲染抛错时退回原文（fallback 分支）', () => {
  let calls = 0;
  const { registrations } = setup(() => {}, {
    // 第一次调用是建 fallback（成功），之后渲染正文就炸 —— 模拟渲染期异常
    h: (type, props, ...children) => {
      calls += 1;
      if (calls > 1) throw new Error('boom');
      return h(type, props, ...children);
    },
  });
  const markdown = registrations.find(
    (registration) => registration.target.key === 'plugin-panel-body:md',
  );
  assert.ok(markdown !== undefined);
  const tree = markdown.component({ content: { kind: 'text', text: '正文' } });
  assert.equal((tree as Element).props['data-dsh-paths-fallback'], true);
  assert.equal((tree as Element).children[0], '正文');
});
