# dsh-plugin-reveal

给 DSH（DeepSeek Harness）的 agent 加一个动作：**`reveal(path)`** —— 把文件摊开到界面的右侧栏里给人看
（HTML 当页面预览、图片直接显示、文本/代码带高亮）。

## 为什么需要它

DSH 给 agent 的工具面里只有 `present`（声明交付物 → 在对话里放一张卡片），而"打开右侧栏面板"的能力
全在**客户端**（`@deepseek-ai/dsh-client-ui-sidebar-right` 提供的跨插件面 `ctx.sidebarRight.openResource`）。
两边都有，中间没有桥 —— 这个插件就是那座桥：

```
agent 调 reveal(path)
  → 服务端：确认文件存在、按 DSH 的地址语法拼出 dsh-resource://file/…
  → 经 SSE（/plugin-reveal/events）把一帧推给所有打开的界面
  → 浏览器那一半：ctx.sidebarRight.openResource(address[, { params: { line } }]) —— 面板打开
```

## 装

这个插件在 **`dsh-plugins` 多包仓**里（`packages/reveal`），所以先在那个仓的根装依赖
（`@deepseek-ai/dsh-tools` / `cordis` 会装在仓根，`packages/*` 都能解析到 —— 不需要手工链 peer）：

```bash
cd <本仓根>   # dsh-plugins/
pnpm install

# 开发：link 装，改源码立刻生效
dsh plugin --profile web add "$PWD/packages/reveal"

# 给人用 / 发布：pack 出来再装（真拷贝，依赖由 pnpm 装进 profile）
pnpm run pack:all
dsh plugin --profile web add "$PWD/.release/dsh-plugin-reveal-<版本>.tgz"
```

推到仓库后也可以 `dsh plugin --profile web add github:<你>/<仓库>`；发到源上（需要发布权限）之后
就是最常见的那条：`dsh plugin --profile web add dsh-plugin-reveal`。

> 契约与坑（依赖解析、客户端包装、地址语法、装完为什么要重启/新开会话）写在仓库的
> [`docs/plugin-contract.md`](../../docs/plugin-contract.md) —— 新插件照着那一份做。

## 验证

- 单测（纯逻辑：地址语法 / 帧 / 本机限制）：`npm test` —— 6 项。
- 真机端到端（2026-09-22，DSH 0.1.5-rc.2 / macOS）：
  1. 插件作为 bundle 挂载后 dsh 正常启动（`dsh web --no-open --port …` 无报错）；
  2. `GET /plugin-reveal/push?sessionId=…&path=…` → 返回 `{"clients":1,…}`：说明浏览器那一半已加载并连上通道；
  3. 用**真实会话 id** 推一帧真实路径 → **右侧栏打开该文件并把 HTML 当页面渲染**（截图为准）。
- 装法（2026-09-23，tarball 装）：`dsh plugin --profile web add <tgz>` → profile 的
  `node_modules/` 里出现真拷贝、`@deepseek-ai/dsh-tools` 被自动装上、`profile.bundles` 自动带上它；
  dsh 正常启动、`/plugin-reveal/push` 有响应、**客户端半边登记进模块图**
  （`/plugins/events` 的 graph 里能看到 `{"id":"dsh-plugin-reveal","url":"/plugins/??dsh-plugin-reveal/client.js…"}`）。
- **没验到的**：agent 真的调用 `reveal` 那一步（工具注册成功、`execute` 里的广播就是上面第 2 步用的
  同一个 `broadcast`，但我没有在同一个会话里让模型跑一次）。第一次用之前请在新会话里试一次。

## 依赖的内部 API（DSH 升级后按这个清单复查）

| 我用到的 | 出处 | 变了会怎样 |
| --- | --- | --- |
| `ctx.tools.register(defineTool({…}))` | `@deepseek-ai/dsh-tools` | 工具注册不上 → 该行报错、dsh 起不来（会在启动日志里点名） |
| `ctx.webServer.register({ kind: 'exact', path, handler })` + SSE | `@deepseek-ai/dsh-client-hmr` 的同一套写法 | 通道挂不上 → 面板不弹（不报错） |
| `ctx.fs.lstat(path, { cwd }, signal)` | `@deepseek-ai/dsh-fs` | 校验失败 → 工具报错 |
| 地址语法 `dsh-resource://file/session/<id>/<path>`（工作区外的绝对路径保留前导 `/`） | `@deepseek-ai/dsh-util-workspace-path` | 地址无效应 → 面板打开空白/报错 |
| `ctx.sidebarRight.openResource(address, { params })` | `@deepseek-ai/dsh-client-ui-sidebar-right`（注释里写明是 *Cross-plugin right-Sidebar face*） | 客户端那一半失效 → 面板不弹（只 `console.warn` 一次） |
| 客户端模块包装 `window.__ModuleLoader__.load({ id, factory })` | `@deepseek-ai/dsh-client-*` 的产物形状 | 客户端那一半加载不上 → 通道没有 client |

失败姿态是刻意设计的：**任何一步坏掉都不影响会话** —— 工具只回报"没打开"和原因，客户端收不到帧就是没反应。

## 维护用的测试口

`GET /plugin-reveal/push?sessionId=…&cwd=…&path=…&line=…`：**只允许本机**（非 loopback 直接 403），
按同一套代码路径推一帧，返回 `{clients, frame}`。它的用途就是上面第 2/3 步那种"不经过模型"的端到端验证；
不需要了可以把 `PUSH_ENDPOINT` 那段删掉（删掉不影响工具）。
