# @yozica/dsh-plugin-paths

让 **DSH 侧栏里看到的东西可点**：Markdown / HTML 内容里的**文件路径**点了在侧栏打开，
**http(s) 链接**点了交给浏览器。

与 [`@yozica/dsh-plugin-reveal`](../reveal/README.md) 的分工：

| 包              | 负责                                                |
| --------------- | --------------------------------------------------- |
| `reveal`        | **agent 主动**把东西摊到侧栏（工具 → 右栏打开资源） |
| `paths`（本包） | 侧栏里**内容自己**可点（接管 md / html 的 body）    |

## 状态

**正式实现**（2026-09-25 起）。接管官方 `md` / `html` 的正文槽位，自己渲染：

| 内容     | 我们的 body 做什么                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| **md**   | 薄 Markdown 渲染；行内代码 / 指向路径的链接 → 可点，点击在侧栏打开（带行号）                                      |
| **html** | 自己的 `sandbox="allow-scripts"` iframe + 桥脚本：拦 `<a>`、把文本里的路径包成可点，全部经 `postMessage` 回父组件 |
| 其它文件 | 不认领，官方 body 原样生效                                                                                        |

机制、真机实证与踩坑：[`docs/panel-path-links.md`](../../docs/panel-path-links.md)。
手动验收夹：[`docs/fixtures/paths-demo.md`](../../docs/fixtures/paths-demo.md)（配 `paths-demo.html` + 相对 css/js）。

### 三条不能忘的机制

1. 正文是两级槽位，但**父槽位 `sidebar.right.pane.tab` 由官方 documentpreview 包按 tab 种类全局注册**，
   我们只注册子槽位 `sidebar.right.tab.document`，`key` = 我们 body 定义的 id；
2. body 定义**必须带 `loading`**（md `'text-pages'`、html `'bytes-complete'`）——
   漏了它官方 TextPreview 不读文件、也不 renderSlot，面板会卡在「正在读取…」；
3. 打包版 Console 里 DSH 界面是 guest `<webview>`，**`console.log` 进不了事件日志**；
   排查要看面板正文（或 `console.warn`，且 0.6.4 那版连 warning 都没落盘）。

## 为什么必须接管（而不是补官方那套）

官方 HTML 预览把内容放进 `sandbox="allow-scripts"` 的 iframe（没有 `allow-popups`），
点击在 iframe 内就被丢掉，外壳收不到、也注入不了脚本；Markdown 那边则会把指路径的链接
当成普通文本。所以两种内容都由本包接管，自己渲染，再自己决定点击去哪。

## 点击去哪

| 点到的东西                       | 行为                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------- |
| 文件路径（绝对 / 相对 / `~/`）   | `ctx.sidebarRight.openResource('dsh-resource://file/session/<sessionId>/<path>')` |
| `path:12` / `path#L12` / `:12:5` | 同上，行号走 `params.line`（列号暂不带）                                          |
| `http(s)` / `mailto` / `tel` …   | `window.open`（Console 里 guest 的 window-open 处理器会交给系统浏览器）           |
| 页内锚点 `#…`                    | 不管，交给浏览器                                                                  |
| 认不出来的 href                  | 渲染成普通文字（**不给点**，免得页面乱跳）                                        |

相对路径的解析顺序（写在 `src/target.ts`）：**先按当前文件所在目录，再按工作区根**；
两个都读不到就把"当前文件目录"那个交给宿主，由宿主报"读不到"。
存在性探测依赖 `ctx.remote.workspaceFiles`，拿不到就不探测（直接按第一条规则打开）。

## 已知降级（接管就要自己保证，写清楚免得被当 bug）

**Markdown**（`src/markdown.ts`，故意只够用、零运行时依赖）：

- 不识别**缩进式代码块**（4 空格），只认围栏代码块；
- 不支持：任务列表复选框、脚注、删除线、数学公式、HTML 块（当纯文本渲染，安全优先）；
- 嵌套列表只做一层；表格只支持基本 `|` 语法（不支持对齐/单元格内换行）；
- **路径只从两处识别**：行内代码、指向路径的 Markdown 链接。正文里的"裸路径词"不识别
  （`a.com`、`and/or` 这类误报代价太高）；
- 行内代码里的**路径不能带空格**（`src/my file.ts` 不认，已知限制）；
- **裸文件名**（无目录）只在扩展名进**白名单**时认：`index.ts`、`paths-demo.html` 认，
  `process.env` / `console.log` / `React.Component` / `1.5` 不认（白名单见 `src/paths.ts` 的
  `BARE_FILE_EXTENSIONS`）。带目录的写法（`src/whatever.env`）则宽松；Markdown 链接里一律按意图认。
- 分页读（`text-pages`）下，未闭合的围栏按"后面都是代码"处理。

**HTML**（`src/bridge.ts` + `src/html.ts`）：

- iframe 的 sandbox **只收紧不放松**：仍是 `allow-scripts`，**不给** `allow-same-origin` / `allow-popups`；
- 相对资源只打包**经典** `script[src]` 与 `link[rel=stylesheet]`（`.js` / `.css`，UTF-8 文本）；
  有 `<base href>` 时整体放弃打包；CSS 里的 `url()` / `@import`、ES module、动态构造的 URL 不支持；
- 单个资源读不到只降级（那一份不打包），正文照常显示；
- 页面脚本仍受沙箱限制（无同源、无弹窗），需要登录/弹窗的页面本来就预览不了。

**其它**：

- client 半边 `require('react')`：它在**宿主的静态模块表**里（壳启动时 seed），无需声明；
  `scripts/check-dist.mjs` 校验客户端产物只 require 静态模块表里的名字或 `dsh.client.external` 里声明过的；
- body 渲染异常时退回显示原文，**不让白屏**；我们没认领的地址（非 md/html）官方 body 照常生效。

## 出问题了怎么查（这台机器上 console 不可信）

1. **右下角红条**：挂载或点击出错时，本包会在页面右下角显示一条红条，并给 `<html>` 打上
   `data-dsh-paths-failed`；成功时**什么都不显示**。之所以留着它：静默失败是这条线上最贵的故障
   （为此来回重启了五轮）。
2. **插件"像不存在一样"**（菜单里没有 `Markdown · paths`、右下角也没红条）：先确认它有没有被组合进 profile ——
   Console 在客户端 `apply` **未捕获**抛错后，会把插件从 `dsh.profile.bundles` 里**自动摘掉**
   （并留一个 `package.json.bak-<时间戳>` 备份）。**不用重启**就能查：

   ```bash
   dsh --profile web --dump-config | grep -B1 -A1 dsh-plugin-paths
   ```

   不在输出里 = 压根没进 profile；去 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 补回来即可。

3. **`console.log` 不是取证手段**：打包版 Console 里 DSH 界面是 guest `<webview>`，只转发
   `error` / `warning`；实测 0.6.4 + Electron 44 下连 warning 也没落盘。要看日志就开 guest 的
   DevTools（`Cmd+Alt+I`）。
4. **写代码时的三条铁律**（真机踩过，改代码前先看 `src/browser.ts` 顶部注释）：
   `inject` 只放真硬依赖；其余服务一律用 `src/services.ts` 的 `serviceOf()` 非严格读取；
   **永远不要直接写 `ctx.xxx`**（未声明的读一下就抛；声明了但拿不到会让 `apply` 静默不执行）。

## 参考（"优秀插件怎么做"）

- 官方文档站：<https://deepseek-harness.github.io/deepseek-harness/develop/basic/>
  （子系统页：[client-modules](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/client-modules)、`sidebar-right`、`ui-slots`、`ui-primitives`）
- 社区指南与索引：[PerryLink/dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)、[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
- 同方向插件：[DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（侧栏 tab + markdown/html 预览，**复用宿主 `MarkdownText`**）
- inject 的坑（社区实测）：[dsh-ego-browser#29](https://github.com/Fisfzy/dsh-ego-browser/issues/29)、[better-sidebar#357](https://github.com/omdsh-dev/DSH-better-sidebar/pull/357)
- 最好的"怎么写"样本是本机装的 **`dshmarket`**：它连 `src/` 都发，
  `src/client/{index.ts,ErrorBoundary.tsx,self-check.ts,primitives.d.ts}` 值得逐个读。

### 我们与官方 `MarkdownText` 的分工（有意为之）

官方 `MarkdownText` 只给**行内代码**留了"文件提及"钩子（`fileMentions.resolve` → `{title,label,open}`），
**相对路径的链接被它判成空 URL → 渲染成纯文本**（壳产物里的 `u8` / `C8`）。
「链接指向路径也要能点」是本包的需求之一，所以 Markdown 这边我们自研薄渲染器；
代价（缩进代码块/任务列表/脚注/公式/代码复制按钮等）见上面的「已知降级」。
**如果哪天只要求行内代码可点，就该整体换成官方 `MarkdownText`** —— 能白拿完整 GFM。

## 安装（本地开发）

```bash
dsh plugin --profile web add link:/绝对路径/dsh-plugins/packages/paths
```

改代码后：`pnpm build` → **重启 dsh**（浏览器半边在页面加载时注入）。

## 测试

```bash
pnpm --filter @yozica/dsh-plugin-paths test    # 路径识别 / Markdown / 渲染产物 / 桥脚本 / 目标解析 / 注册契约
pnpm check:dist                                 # 产物形状 + host require 白名单
```

真机验收走 `docs/fixtures/paths-demo.md`。
