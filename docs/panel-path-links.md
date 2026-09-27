# 面板里的文件路径可点（设计note + 实现清单）

面向实现者。结论都有出处（契约类型 / 官方包源码 / 本机实测），先读完再动代码。

## 现状（本机实测，2026-09-25）

| 场景                                                              | 结果                                                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 侧栏里 **Markdown 内容中的 http(s) 链接**                         | ✅ **本来就能点**（Markdown body 是 React 直渲的，不是 iframe）                                                                                |
| 侧栏里 **裸路径**（`` `src/a.ts` ``）、**指路径的 Markdown 链接** | ❌ 渲染成普通文本，"本身就是文本"                                                                                                              |
| 侧栏里 **HTML 预览**中的任何链接                                  | ❌ 点不动 —— 官方用 `sandbox="allow-scripts"` 的 iframe（无 `allow-popups`），点击在 iframe 内就被丢掉，**外壳收不到、我们救不了，也不该去改** |

所以本文件的范围是**两条**，都落在新包 `@yozica/dsh-plugin-panel-body` 里；`@yozica/dsh-plugin-reveal`
**只保留"agent 主动把东西摊到侧栏"这一个能力，不动**：

| 内容类型                     | 谁渲染                               | 要解决的问题                 |
| ---------------------------- | ------------------------------------ | ---------------------------- |
| **Markdown**                 | 我们接管官方 `md` body（React 组件） | 裸路径 / 指路径的链接 → 可点 |
| **HTML**                     | 我们自己的 iframe + 桥脚本（见下）   | 内容里的 `<a>` 与路径 → 可点 |
| 其它（图片 / PDF / 纯文本…） | 官方 body 原样                       | 不改                         |

## 官方机制（读契约 + `dsh-client-ui-sidebar-documentpreview` 源码得到）

有两种扩展点，本方案用第一种：

**① 注册 body（内容渲染器）**

```ts
// 1) 定义：这个 body 认领哪些文件
ctx.documentPreviews.register({
  id: '@yozica/dsh-plugin-panel-body:md',
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

## HTML 预览怎么做（我们自己的 iframe + 桥脚本）

官方 html body 是 `sandbox="allow-scripts"` 的 iframe（无 `allow-popups`），而且内容是别人画的、
我们注入不了脚本 —— 所以**只能接管**：`extensions: ['html', 'htm']` 用我们自己的 body。

设计：**不放行弹窗，全部点击经 postMessage 回到父组件**，父组件再决定去哪。

```
我们自己渲染的 iframe（sandbox 保持最小集：allow-scripts，不给 allow-same-origin）
  注入一小段桥脚本：拦 <a> 点击 + 把路径文本包成可点
  → parent.postMessage({ source: 'dsh-plugin-panel-body', kind: 'url' | 'path', target, line? })
父组件（DSH 页面这一层，不在沙箱里）
  kind === 'url'  → window.open(target, '_blank')   // Console 里走 guest handler → 系统浏览器
  kind === 'path' → ctx.sidebarRight.openResource(dsh-resource://file/session/<id>/<path>)
```

为什么这样比"给 iframe 加 `allow-popups`"好：① 不依赖沙箱放行弹窗；② 两类目标（网页 / 文件）
走同一条路，行为一致；③ 仍然保留样式与脚本隔离（iframe 仍是独立源）。

代价（要自己保证的）：官方 html body 的细节（相对资源加载、缩放、CSP）我们接管后要自己做到位；
iframe 的 sandbox 只能收紧不能放松（**不许**加 `allow-same-origin`）。

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

- **走这条路**：新开一个 UI 包 **`@yozica/dsh-plugin-panel-body`**，接管 `md` body，自己渲染 + 路径可点。
- **`@yozica/dsh-plugin-reveal` 保持"client 半边零 host require"**（它的卖点之一），不要往里塞 UI。
- **已知代价（明确接受）**：UI 包 client 半边依赖宿主 `react`（可能还有 primitives）→ `scripts/check-dist.mjs` 里"host require 必须为空"那条断言要**按包区分**（纯 ctx 包 vs UI 包），不能一刀切。

## 实现清单（按顺序）

1. ✅ `scripts/build-client.mjs`：`react` / `react-dom` / `react/jsx-runtime` 进 external。
2. ✅ 新包 `packages/panel-body/`：
   - `package.json`：`dsh.bundle.patch` → `./cordis.patch.yml`；`dsh.client { platform, inject }`
     （**不需要**声明 `react`：它在宿主的静态模块表里，见「host require 到底怎么判」）；
     `files` 含 `lib` + patch + README。
   - `cordis.patch.yml`：`- insert: [{ id: panel-body, name: '@yozica/dsh-plugin-panel-body' }]`。
   - `src/index.ts`：server 半边最小实现（`name` / `inject` / `apply`），只为让 bundle 能被装配。
   - `src/browser.ts`：**唯一** `import react` 的文件，只做接线；被 tsconfig 排除，仅由 esbuild 打包。
3. ✅ 组件（拆成可单测的纯模块，React 只从 `browser.ts` 注入）：
   - `src/markdown.ts` 薄 Markdown 解析；`src/view.ts` AST → 元素树（`h` 注入，测试用假 `h`）。
   - **路径识别** `src/paths.ts`：行内代码里的相对/绝对路径、`path:line` / `path:12:5` / `path#L12`、
     指向路径的 Markdown 链接 href → 渲染成可点元素；**代码块里不识别**。
   - 点击路由 `src/target.ts`：路径 → `openResource(dsh-resource://file/session/<id>/<path>)`（带行号走 `params.line`）；
     `http(s)` → `<a target="_blank">` 交给浏览器（HTML 里经桥 → `window.open`）。
   - sessionId 来源：正文地址 `resourceAddress`（= `tab.contentId`）自己解析（复用 kit 新增的 `parseSessionFileAddress`）。
   - HTML：`src/html.ts` 打包相对 `script` / `link` 资源 + `src/bridge.ts` 生成 iframe `srcdoc`（引导脚本 + 点击拦截 + 路径包裹）。
4. ✅ 兜底：Markdown 解析/渲染异常退回显示原文（`data-dsh-panel-body-fallback`）；
   只按扩展名认领 `md` / `markdown` / `html` / `htm`，**我们没认领的地址官方 body 照常生效**
   （候选列表里官方定义仍在，查看器菜单还能切回去）。
5. ✅ 测试（`packages/panel-body/test/`，35 个）：
   - `paths.test.ts` 路径识别表（相对 / 绝对 / 带行号 / `~` / Windows 反斜杠 / 误报样本）；
   - `markdown.test.ts` 解析（未闭合围栏、转义、引用式链接不认）；
   - `view.test.ts` 渲染产物断言（可点元素、代码块不识别、外链属性）；
   - `contract.test.ts` fake ctx 断言注册形状与 `key` 一致（**且绝不碰父槽位**）；
   - `bridge.test.ts` 用 `node:vm` 校验生成的引导脚本**语法正确**（`</script>` 转义没写坏）；
   - `target.test.ts` 候选顺序 / 行号透传 / 探测抛错降级；
   - `services.test.ts` 非严格读服务（含"假 ctx 里一个读属性就抛的代理"）；
   - `check-dist`：客户端产物的 host require 必须落在宿主**静态模块表**里（或写进 `dsh.client.external`）。
   - ⏳ e2e（真 dsh + 无头 Chrome）还没做；当前靠 `docs/fixtures/panel-body-demo.*` 手动验收。
6. ✅ 真机：`link:` 进 `~/.dsh/profiles/web` → 重启 dsh → `reveal` 打开 `docs/fixtures/panel-body-demo.md` 点一遍
   （2026-09-25 逐条跑通，见文末）。

## 相对路径怎么解析（已定；实现见 `src/target.ts`）

md / html 里的路径有三种写法，语义不同，必须写死规则（否则"点了打开别的文件"更难查）：

| 写法                                | 建议规则                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `src/a.ts`（相对）                  | 先按**该文件所在目录**解析；不存在再按**工作区根**解析；都不存在就报"没找到" |
| `/Users/…`（绝对）                  | 直接用；但仍要走 `ctx.fs` 校验存在性，不存在就报错                           |
| `` `a.ts:12` ``（带行号）           | 拆出行号，打开时传 `params.line`（DSH 侧栏支持按行定位）                     |
| 代码块 / 行内代码里的"像路径的东西" | 行内代码识别、**代码块里不识别**（避免把示例代码变成链接）                   |

## 探针要验的三件事（第一步就做）

1. **body 能不能真的接管**：注册一个只画"接管成功 + 地址"的 body，`link:` 进 profile、重启 dsh，
   用一个 md 与一个 html 各验一次 —— 确认 `key` ↔ `sidebar.right.tab.document` 槽位的对应，以及
   `priority: 'extension'` 确实压过 builtin（而在我们没认领的地址上官方 body 依旧生效）。
2. **桥脚本的 postMessage 稳定到达**：iframe 里点 `<a>`／路径，父组件能收到并区分 `kind`。
3. **两条路由在两种环境下都对**：Console 内嵌页（`http` → 系统浏览器，`path` → 侧栏换内容）与
   纯浏览器（`http` → 新 tab，`path` → 侧栏换内容）。

## 未决 / 风险

- ✅ **已解决（2026-09-25 真机）**：子槽位 `key` = 我们 body 定义的 id；父槽位 `sidebar.right.pane.tab` 由官方包按 **tab 种类**全局注册，**不需要也不该由我们参与**；第一版卡住的真原因是定义漏了 `loading`。见文末「探针实测结论」。
- ✅ **已解决**：`check-dist` 现在按**宿主真实机制**校验 host require（静态模块表 ∪ `dsh.client.external`）。
  注：我原先自造的 `dsh.client.hostRequires` 字段在官方文档/代码里**不存在**，已删除（见文末审计）。
- ⚠️ **降级要接受**：接管后官方 Markdown 的进阶渲染（任务列表 / 脚注 / 缩进代码 / HTML 块）与部分 HTML 资源形态不再支持 ——
  清单在 [`packages/panel-body/README.md`](../packages/panel-body/README.md) 的「已知降级」，改动前先看。
- ⚠️ 依赖宿主 `react` 与 `documentPreviews` / `slots` / `remote.workspaceFiles` 的形状，会随上游变动；
  包可单独卸载，坏了不影响 `reveal` 与 dsh 本体。
- ⏳ e2e（真 dsh + 无头 Chrome）与"纯浏览器（非 Console）"两条路由还没自动化覆盖。
- ⚠️ **行号定位（`:30` 那种）由宿主实现，我们控制不了精度 —— 实测有偏差**（2026-09-26 真机）：
  点 `…/plug.ts:30`，滚动落点大约在第 34 行附近，**且没有任何行出现目标的底色高亮**。
  高亮样式是有的（宿主 CSS 里 `.dhJKeW_lineTarget{background:var(--dsw-alias-interactive-bg-hover)}`），
  没出现说明**宿主始终没把那一行认成目标行**。
  **我们这条链是正确的**：`splitLocation` 解出 `line: 30` → `data-dsh-panel-body-line="30"` →
  `sidebarRight.openResource(address, { params: { line: 30 } })`，全程没有转换或加偏移。
  宿主侧的自相矛盾在 `dsh-client-ui-sidebar-documentpreview`：渲染侧
  `const number = page.offset + index` 是 **0-based**，而负责揭示目标行的入口注释自称
  **"1-based source line"**。这是上游的实现，改了下次 dsh 升级就丢 —— **所以我们不做补偿**
  （补偿宿主 bug 有把正确情形也带偏的风险）。夹具那句"应跳到第 30 行附近"就是这个意思：
  验收标准是**附近**，不是精确行。

## 探针实测结论（2026-09-25，真机）

### 第一版探针：**假阴性**（当时的结论已被推翻）

第一版（`title` + 按扩展名注册 body + 子槽位组件；组件只 `console.log` 并返回 `null`）装上后：

| 观察                                     | 结果              | 事后判定                                                           |
| ---------------------------------------- | ----------------- | ------------------------------------------------------------------ |
| 查看器按钮显示 `md · paths`              | ✅                | 定义确实被选中（header 里 `selected.title()`），不是"另一条路生效" |
| 日志里 `[panel-body-probe] body invoked` | ❌ 一条没有       | **这条证据无效** —— 见「坑 ②」                                     |
| 面板正文                                 | 卡在「正在读取…」 | 真原因：定义漏了 `loading`（见下）                                 |

「卡住」是真的，「日志没有」是假的。把这两件事当成一件事查，方向就偏了一整轮。

### 第二版探针：**真机跑通**

修正只有两处：定义里补 `loading` / `wrap`；日志改用 `console.warn`，并让组件**返回一段可见文字**。
真机装进 `web` profile、重启 dsh、用 `reveal` 打开一个 `.md` 后：

| 证据                                                                              | 结果               |
| --------------------------------------------------------------------------------- | ------------------ |
| 面板正文显示 `[panel-body-probe] body invoked · dsh-resource://…（content=text）` | ✅ **body 被调用** |
| 组件只返回一个字符串、不引 React，面板就显示那一行（没有 React 报错）             | ✅ 组件契约成立    |

→ **接管机制成立；父槽位不需要我们注册；子槽位 `key` 就是 body 定义的 id。**

### 结论：父槽位的 key **不从 claim 传**，也不该由我们注册

正文确实是两级槽位，但第一级**不由 body 提供者注册**：

```js
// ① 父：官方包在 apply 里**全局注册一次**（client.js:26946-26960）
//    key = TEXTPREVIEW_ID = "@deepseek-ai/dsh-client-ui-sidebar-documentpreview" = **tab 种类**的身份
//    同一份 textDefinition() 还注册进 sidebarRightTabs（client.js:1766-1775, 26935）：
//    kind:"text"、patterns:["dsh-resource://file/**"]、priority:"fallback"、canOpen(scope==="session")
//    → "谁画 file: 标签"在 tab 种类这一层就定死了，与扩展名、与我们的 body 无关
ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TEXTPREVIEW_ID, ...,
  children: { 'sidebar.right.tab.document': { kind: 'keyed', scope: 'session', ... } } }, TextPreview)

// ② 子：每个 body 各自注册，key = 自己的 body id
ctx.slots.register({ name: 'sidebar.right.tab.document', key: PLAIN_BODY_ID }, TextBody)
```

body 的选择发生在官方 `TextPreview` **内部**：

```js
const candidates = matchingDocumentPreviews(definitions, file.path); // priority band → 最长后缀 → 注册序
const selected = candidates.find((c) => c.id === state?.rendererId) ?? candidates[0];
content !== void 0 && renderSlot('sidebar.right.tab.document',
  { resourceAddress, content, wrap, scrollportRef }, { entryKey: selected.id, ... });
```

`entryKey = selected.id` 就是**我们 body 定义的 id**，与子槽位注册的 `key` 天然对齐。
（另：`sidebar-right` 的 `bodiesFor` / `titlesFor` 用 `definition?.id ?? tab.kind` 往 `pane.tab` 派发，
那个 `definition` 是 **tab 种类**定义，与扩展名无关 —— 别把它当 body 的 key。）

### 第一版为什么卡住（真根因）：定义漏了 `loading`

上文的注册范本里本来就有 `loading` / `wrap`，第一版探针**实现时漏抄了这两个字段**。
官方 `TextPreview` 里的因果链（`dsh-client-ui-sidebar-documentpreview/lib/client.js`）：

| 证据                                                                                           | 行号                            |
| ---------------------------------------------------------------------------------------------- | ------------------------------- |
| `fresh()` 状态里**没有 `mode` 字段**                                                           | 1883-1895                       |
| `const mode = selected?.loading;`                                                              | 1423                            |
| `const current = (state?.mode ?? 'text-pages') === mode ? state : void 0;` → 恒 `undefined`    | 1424                            |
| `if (started \|\| !canRead \|\| mode === void 0) return;` → **根本不读文件** → 卡「正在读取…」 | 1451                            |
| `content` 依赖 `current`；`content !== void 0 && renderSlot(...)` → **永不 renderSlot**        | 1497-1508, 1664                 |
| 官方取值：md `loading:'text-pages'`；html / image / pdf `loading:'bytes-complete'`             | 2156-2164, 2441-2449, 2640-2652 |

而 `title` 走的是另一条路（header 的查看器按钮直接 `selected.title()`，1592/1597），
于是出现「按钮写着 `md · paths` 但组件从没被调用」这种极具误导性的组合。

### 踩过的坑（值得记住）

- **① `dsh.client.inject` 里的包名必须真实存在**，否则 loader **静默跳过**整个客户端半边：
  没日志、没报错、`apply` 根本不跑。第一版我写了 `@deepseek-ai/dsh-client-ui-slots`——
  安装里**没有**这个包（槽位注册表由 `@deepseek-ai/dsh-client-ui-renderer` 提供），
  于是探针"什么都没发生"，排查成本很高。
- **② guest console 的 `console.log` 进不了 Console 的事件日志**：打包版里 DSH 界面是宿主窗口里的
  一个 `<webview partition="persist:dsh-ui">`（`app.asar` 里 `id:"ui-view"`），而 Console 只把 guest 的
  `error` / `warning` 转发进 `<userData>/logs/console.log`（`app.asar` → `wireGuestDiagnostics`）。
  所以**拿 `console.log` 当探针证据 = 永远看不到**。更糟的是实测（0.6.4 + Electron 44）
  那份 `logs/console.log` 自 13:35 起**一字未写**，连 `console.warn` 也没落盘 ——
  所以**最可靠的证据是面板正文**，不是日志。
- **③ 探针组件一定要返回可见文字**：这次正是那行 `[panel-body-probe] body invoked · …` 在日志全哑的情况下
  给出了决定性证据。只 `return null` 的话，就只能看到"面板变空"，无法与"没接管"区分。
- 探针装着期间，**侧栏打开 md / html 会显示探针的占位文字**（地址被我们接管）。
  验完记得撤掉 profile 里那三处改动（依赖行 / bundles 末项 / `node_modules` 符号链接）。

## 正式实现真机跑通（2026-09-25，真机）

`docs/fixtures/panel-body-demo.md` 逐条点过，全部符合预期：

| 验收点                                                                                        | 结果 |
| --------------------------------------------------------------------------------------------- | ---- |
| 查看器菜单出现 `Markdown · paths`（我们的定义被选中）                                         | ✅   |
| 行内代码里的相对路径（`panel-body-demo.html`、`./panel-body-demo.css`）可点                   | ✅   |
| 工作区根相对路径 + 行号（`dsh-plugins/packages/panel-body/src/plug.ts:30`）在右侧栏打开并定位 | ✅   |
| Markdown 链接指向路径 → 右侧栏换内容（浏览器地址栏不动）                                      | ✅   |
| `http(s)` 链接 → 交给系统浏览器                                                               | ✅   |
| 代码块里的路径、`const x = 1`、`and/or`、`a.ts`、`https://…/x.md` **不可点**                  | ✅   |
| 不存在的路径 → 右侧栏显示"读不到"                                                             | ✅   |
| HTML 预览：相对 CSS 生效、裸路径可点、`<a>` 按 url / path 分流                                | ✅   |

### ⚠️ 这张表当初漏了一格：`..` 越过工作区根（2026-09-26 真机撞上）

上面「Markdown 链接指向路径」只验了**换内容**，没验**目标路径对不对**；而当时的夹具
`panel-body-demo.md` 里的链接是**同目录**的 —— 于是「相对路径里的 `..`」整条路从没被走到。
真机上第一例就挂了：`packages/panel-body/README.md` 里的 `../../docs/panel-path-links.md`
打开成了 `packages/panel-body/docs/panel-path-links.md`（`..` 被当成普通目录名）。

**成因**：插件用**工作区相对路径**拼候选、再用 `read` 探存在性，而 `read` 只认工作区内。
相对路径经 `..` 越过工作区根后两个候选都探不到，于是退回第一条候选，
把拼错的相对路径直接写进地址。

**改法**：改用宿主 `workspaceFiles.stat`（它接受"绝对路径或工作区相对路径"，
**工作区外也允许**）把候选解析成**绝对路径**，再按工作区外的写法造地址 ——
**解析交给宿主，不自己拼字符串**。

**教训（写下来免得再犯）**：验收表里写"换内容"不够，**要写清目标是什么**；
夹具也要覆盖"跨目录 / 越过工作区根"这类边界，不能只有同目录那一种。

### 正式实现路上又踩的三个坑（比探针那轮更贵）

1. **cordis 的 `ctx` 是代理：没在 `inject` 里声明的服务，读一下就抛。**
   `ctx.remote` 一读就 `cannot get property "remote" without inject` → 整页 `Failed to load plugins`。
2. **`inject` 里放了一个"拿不到"的服务，fiber 就停在 INACTIVE，`apply` 根本不执行**，而且**完全静默**
   （cordis `_refresh()`：任一 inject 项没有 impl 就 `epoch = INACTIVE`，`_updateState` 直接卸载/不加载）。
   所以 `inject` 只放真硬依赖（本包是 `documentPreviews` / `slots`），其余走
   `ctx.reflect.get(name, false)` 非严格读取（实现收在 `packages/panel-body/src/services.ts`）。
3. **嵌套服务名是独立的服务**：官方注入 `remote` _和_ `remote.workspaceFiles` 两个名字；
   只拿到 `remote` 那个面、再读它的 `.workspaceFiles`，一样触发第 1 条守卫。

还有一条**工具性**的坑，值得每个 DSH 插件作者记住：

4. **客户端 `apply` 的未捕获抛错，会让 Console 把插件从 profile 的 `dsh.profile.bundles` 里自动摘掉**
   （并在同目录留一个 `package.json.bak-<时间戳>`）。表现是"重启也没用、日志里什么都没有、
   插件像不存在一样" —— 我们就在这上面白绕了两轮。排查命令（**不需要重启**）：

   ```bash
   dsh --profile web --dump-config | grep -B1 -A1 <包名>
   ```

   条目不在 dump 里 = 它压根没被组合进 profile，与插件代码无关。
   （`--dump-config` 会重写 profile 的 `cordis.yml`；在 DSH 自己的沙箱里跑要放行工作区外的写。）

5. **`console.log` 不是取证手段**（见「坑 ②」）。所以正式实现里保留了
   **失败才会出现**的兜底：右下角一条红条 + `<html data-dsh-panel-body-failed>`；
   成功时界面干干净净。静默失败才是最贵的故障。

## 审计：优秀插件怎么做，我们改了什么（2026-09-25）

看了三类样本，都是本机可核对的东西：

| 样本                                                          | 看什么                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `dshmarket`（真实第三方 UI 插件，**连 `src/` 都发了**）       | `src/client/index.ts` / `ErrorBoundary.tsx` / `self-check.ts` / `primitives.d.ts` |
| 官方壳里的 `MarkdownText`（`dsh-web-frontend` 产物里的 `w8`） | 渲染策略、`fileMentions` 钩子、链接放行规则                                       |
| 官方教学文档（`dsh-cordis-client-runner` 的 API 文档文本）    | `ctx.get` vs `inject` 的取舍、`slots.register` 字段语义                           |
| 公开资料（见 README「参考」一节的链接）                       | 官方文档站、社区指南、别人的 inject 踩坑记录                                      |

### 结论：官方 `MarkdownText` 的路径能力只有一半

```js
// 行内代码：官方**留了钩子**
case "inlineCode": {
  const c = i.inLink === true ? undefined : i.fileMentions?.resolve(s);
  return c !== undefined
    ? <code><button type="button" className={lt.fileMention} title={c.title} onClick={c.open}>
        <LinkIcon kind={W6(s)}/>{s}</button></code>
    : <code>{s}</code>;
}
// 链接：相对路径被 `u8` 判死 → 渲染成纯文本（`C8` 返回 <>{children}</>）
function u8(t){ try { switch(new URL(t).protocol){
  case"http:": case"https:": case"mailto:": return t; default: return "" } } catch { return "" } }
```

所以「换成官方 `MarkdownText` + `fileMentions`」只能覆盖**行内代码里的路径**，
`[说明](docs/a.md)` 这类**指路径的链接会退回纯文本** —— 而那是这条线的明确需求。
**这就是我们保留自研薄渲染器的唯一理由**（代价见 `packages/panel-body/README.md#已知降级`）；
哪天只需要行内代码可点，就该切成官方 `MarkdownText`，能白拿 GFM/脚注/公式/代码复制按钮。

### 据此改的 9 处

| #   | 问题（谁教的）                                                                                                                 | 改法                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **每次滚动都在重解析整篇 Markdown**（官方是 `React.memo` + `useMemo`）                                                         | Markdown body 用 `useMemo`，同正文只解析一次                                                                                                                                                                        |
| 2   | **没有错误边界**：渲染期抛错 → React 卸载整棵子树 → 白屏（`dshmarket` #293 白屏了几个月）                                      | 加 `PathsBoundary`，崩了显示原文；**工厂里定义**，模块求值不碰 `React.Component`                                                                                                                                    |
| 3   | 路径链接用了 `href="#"`：cmd/中键点击会让壳把**应用自身 URL** 交给系统浏览器                                                   | 去掉 `href`（官方文件提及也是无 `href` 的 `<button>`）                                                                                                                                                              |
| 4   | **文案硬编码**散在 4 个文件（`dshmarket` 一句都不硬编码）                                                                      | 集中到 `src/strings.ts`；将来接 `ctx.locale` 只改这个文件                                                                                                                                                           |
| 5   | 宿主 react 缺导出会在**渲染时**炸                                                                                              | `apply` 先做能力自检（`missingReact`，对齐 `dshmarket` 的 `missingPrimitives`），缺就干净降级                                                                                                                       |
| 6   | `slots.register` 返回值未必是 disposer（`dshmarket` 有兜底）                                                                   | `asDisposer()` 收敛后再交给 `ctx.effect`                                                                                                                                                                            |
| 7   | 可选服务读法是我自创的 `reflect.get(name,false)`                                                                               | 首选官方推荐的 **`ctx.get(name)`**（社区同款修法：静态 inject 塞可选服务会把整个 client boot 挂死）                                                                                                                 |
| 8   | 自造的 `dsh.client.hostRequires` 字段**在公开文档/代码里不存在**                                                               | 删掉；`check-dist` 改成按**宿主真实机制**判：静态模块表 ∪ `dsh.client.external`                                                                                                                                     |
| 9   | **裸文件名一律不认**，于是 `` `panel-body-demo.html` `` 点不动 —— 而**我们自己写的验收夹却把它列成"应该可点"**（真机一测就露） | 行内代码的裸文件名改成按**已知扩展名白名单**认：`index.ts` / `plug.ts:30` / `panel-body-demo.html` 认；`process.env` / `console.log` / `React.Component` / `1.5` 仍不认（`src/paths.ts` 的 `BARE_FILE_EXTENSIONS`） |

### 顺带确认的两件事

- `dsh-client-ui-primitives` 在本机不是独立安装包，而是**壳的静态模块**（`dsh-web-frontend` 的
  `staticModules` 表里：`react` / `react-dom` / `cordis` / `client-store` / `ui-slots` /
  `ui-primitives` / `ui-dockkit`）。所以 UI 插件 `require('react')` 不需要任何声明。
- 社区实测记录与我们踩的坑一致：**静态 `inject` 里放一个拿不到的服务会让整个客户端半边
  静默不激活**（ego-browser #29 / better-sidebar #357），修法就是 `ctx.get` 探测 +
  服务出现后再 `ctx.inject()` 升级。
