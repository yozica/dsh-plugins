# 面板里的文件路径可点（设计note + 实现清单）

面向实现者。结论都有出处（契约类型 / 官方包源码 / 本机实测），先读完再动代码。

## 现状（本机实测，2026-09-25）

| 场景                                                              | 结果                                                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 侧栏里 **Markdown 内容中的 http(s) 链接**                         | ✅ **本来就能点**（Markdown body 是 React 直渲的，不是 iframe）                                                                                |
| 侧栏里 **裸路径**（`` `src/a.ts` ``）、**指路径的 Markdown 链接** | ❌ 渲染成普通文本，"本身就是文本"                                                                                                              |
| 侧栏里 **HTML 预览**中的任何链接                                  | ❌ 点不动 —— 官方用 `sandbox="allow-scripts"` 的 iframe（无 `allow-popups`），点击在 iframe 内就被丢掉，**外壳收不到、我们救不了，也不该去改** |

所以本文件要解决的范围只有一条：**让面板内容里的文件路径可点**（点了在侧栏打开对应文件）。

## 官方机制（读契约 + `dsh-client-ui-sidebar-documentpreview` 源码得到）

有两种扩展点，本方案用第一种：

**① 注册 body（内容渲染器）**

```ts
// 1) 定义：这个 body 认领哪些文件
ctx.documentPreviews.register({
  id: '@yozica/dsh-plugin-paths:md',
  extensions: ['md'], // 也可以用 canOpen/patterns 一类判定
  priority: 'extension', // extension 可以接管 builtin 同 kind 的位子
  title,
  loading,
  wrap,
});
// 2) 组件：注册进「tab 内容」槽位，key 就是上面那个 id
ctx.slots.inject('sidebar.right.tab.document', () =>
  ctx.slots.register({ name: 'sidebar.right.tab.document', key: '<上面的 id>' }, Component),
);
```

出处：`packages/reveal` 之外的本机安装里，`@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js` 的 `apply$6`：

```js
ctx.effect(() => ctx.documentPreviews.register(textBodyDefinition(() => t('viewer.text'))));
ctx.effect(() =>
  ctx.slots.inject('sidebar.right.tab.document', () =>
    ctx.slots.register(
      {
        name: 'sidebar.right.tab.document',
        key: PLAIN_BODY_ID,
      },
      TextBody,
    ),
  ),
);
```

`documentPreviews` 是 `ctx.reflect.provide("documentPreviews", …)` 挂出来的软服务（`documentpreview` 提供）。

**② 注册 tab 类型（容器）** —— 只在需要"新开一种 tab"时才用，本方案**不需要**：

```ts
ctx.sidebarRightTabs.register({ id, kind, patterns?, canOpen?, priority: 'extension', title });
// registry: register(definition) / candidates(address) / claim(address, kind?)
```

排序规则（`tab-registry.d.ts`）：band（fallback < builtin < extension）→ 匹配到的 pattern 长度 → 注册顺序；`canOpen` 是否决权。`contentId` 就是地址本身（同一地址重复打开是同一个 tab）。

## 社区范例（告诉我们 UI 插件怎么拿 React）

`dshmarket/client/client.js` 开头：

```js
window.__ModuleLoader__.load({ id: "dshmarket", factory: (require) => {
  …
  require("react"); require("react-dom"); require("@deepseek-ai/dsh-client-ui-primitives");
  ctx.slots.register(…); ctx.slots.inject(…);
}});
```

→ **UI 插件从宿主 `require` React 是既有做法**；我们的构建脚本已把 `react` 一族加进 esbuild 的 external（`scripts/build-client.mjs`）。

## 决定（已裁定）

- **走这条路**：新开一个 UI 包 **`@yozica/dsh-plugin-paths`**，接管 `md` body，自己渲染 + 路径可点。
- **`@yozica/dsh-plugin-reveal` 保持"client 半边零 host require"**（它的卖点之一），不要往里塞 UI。
- **已知代价（明确接受）**：UI 包 client 半边依赖宿主 `react`（可能还有 primitives）→ `scripts/check-dist.mjs` 里"host require 必须为空"那条断言要**按包区分**（纯 ctx 包 vs UI 包），不能一刀切。

## 实现清单（按顺序）

1. ✅ `scripts/build-client.mjs`：`react` / `react-dom` / `react/jsx-runtime` 进 external（已改）。
2. 新包 `packages/paths/`：
   - `package.json`：`dsh.bundle.patch` → `./cordis.patch.yml`；`dsh.client { platform: 'web', inject: [<dsh-client-ui-sidebar-documentpreview>, <dsh-client-ui-slots>, <dsh-client-ui-sidebar-right>] }`；`files` 含 `lib` + patch + README。
   - `cordis.patch.yml`：`- insert: [{ id: paths, name: '@yozica/dsh-plugin-paths' }]`。
   - `src/index.ts`：server 半边最小实现（`name` / `apply`），只为让 bundle 能被装配。
   - `src/browser.ts`：注册 body + 组件（用 `require('react')` 的 `createElement`，避免为一个探针引入 JSX 工具链；正式做时再决定要不要 `.tsx`）。
3. 组件（核心工作量）：
   - 薄 Markdown 渲染：标题 / 列表 / 粗斜体 / 行内代码 / 代码块 / 链接 / 段落（够用即可，别引重库）。
   - **路径识别**：反引号里的相对或绝对路径、`path:line` 形式、Markdown 链接指向路径的 href → 都渲染成可点元素。
   - 点击路由：路径 → `ctx.sidebarRight.openResource(dsh-resource://file/session/<sessionId>/<path>)`（带行号时可传 `params.line`）；`http(s)` → 保持 `<a target="_blank">` 交给浏览器。
   - sessionId 从哪来：与 `reveal` 同源（服务端帧里带 session；或从 `ctx` 的 session 面拿）。
4. 兜底：渲染异常时显示原文而不是白屏；**不要**让官方 md 预览在我们不认领的地址上失效（靠 `canOpen`/`extensions` 的收窄 + 一次真机核对）。
5. 测试：
   - 单测：路径识别表（相对/绝对/带行号/`~`/Windows 反斜杠/代码块内不识别）+ 渲染产物断言。
   - 契约测试：fake ctx 断言"`documentPreviews.register` + `slots.register` 的调用形状与 key 一致"（这是最容易静默错的地方）。
   - `check-dist`：按包区分 host require 规则。
   - e2e：真 dsh + 无头 Chrome 打开一个含路径的 md，断言路径元素存在、点击后侧栏内容变化。
6. 真机：`link:` 进 `~/.dsh/profiles/web` → 重启 dsh → 用 `reveal` 打开一个 md 验证（当前 profile 里 reveal 已经是 link 装的，paths 包按同样方式加）。

## 未决 / 风险（实现时先验证）

- body 的 `key` 与槽位 `sidebar.right.tab.document` 的对应关系，目前是从官方源码**读出来**的，还没用我们自己的包跑通一次 —— 这是第一个要打通的点（探针：注册一个 body，看它是否真的接管了 md 的渲染）。
- 接管 md 后，官方的进阶渲染（表格 / 任务列表 / 图片 / sanitize）我们要补或接受降级；降级要写进 README 说清楚。
- 依赖宿主 React/primitives 会随上游变动（选 A 的已知代价）；包要能单独卸载，坏了不影响 `reveal` 与 dsh 本体。
