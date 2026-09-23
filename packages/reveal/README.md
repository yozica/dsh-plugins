# @yozica/dsh-plugin-reveal

给 DSH 的 agent 一个动作：**`reveal(path[, line])`** —— 在界面的**右侧栏**里把文件摊开给人看
（HTML 当页面预览、图片直接显示、文本/代码带高亮）。

## 为什么需要插件

DSH 给 agent 的工具面里只有 `present`（声明交付物 → 对话里放一张卡片），而"打开右侧栏"的能力
全在**浏览器**那半（宿主提供的跨插件面 `ctx.sidebarRight.openResource`）。两边都在、中间没有桥 ——
这个插件就是那座桥：

```
agent 调 reveal(path)
  → 服务端（本包 lib/index.js）：确认文件存在 → 按 DSH 地址语法算出 dsh-resource://…
  → 经 SSE（/plugin-reveal/events）把一帧推给所有打开的界面
  → 浏览器（本包 lib/client.js）：ctx.sidebarRight.openResource(address) → 面板打开
```

两半之间的桥、地址语法、工具定义都来自 [`@yozica/dsh-plugin-kit`](../kit/README.md)；
**本包不 import 任何 `@deepseek-ai/*`**。

## 装

```bash
# 开发：link 装（改源码后重新 pnpm build 生效）
pnpm build && dsh plugin --profile web add "$PWD/packages/reveal"

# 给人用 / 发布：tarball（真拷贝，依赖由 pnpm 装进 profile）
pnpm pack:all && dsh plugin --profile web add "$PWD/.release/@yozica-dsh-plugin-reveal-<版本>.tgz"

# 发到源上之后：dsh plugin --profile web add @yozica/dsh-plugin-reveal
```

装完记得：**重启 dsh**（bundle 列表是启动时读的）+ **新开一个会话**（工具面是会话启动时定的）。

## 卸

```bash
dsh plugin --profile web remove @yozica/dsh-plugin-reveal
```

profile 自己的补丁层不用动 —— 这个包是 **bundle** 装法，挂载行写在它自带的 `cordis.patch.yml` 里。

## 验证

```bash
pnpm -r test        # 纯逻辑单测（地址语法在 kit 里）+ 契约测试（假 ctx 断言注册了什么）
pnpm check:dist     # 产物形状：服务端导出 name/inject/apply；浏览器边是 loader 包装且无 host require
```

**真机端到端**（维护用测试口，只允许本机）：

```bash
# 1) 起一个 dsh，拿到它的端口与 token 地址
# 2) 打开界面，确认浏览器半边连上了频道（返回里的 clients 应 ≥ 1）
curl -s "http://127.0.0.1:<端口>/plugin-reveal/push?sessionId=<会话id>&path=/某个/文件.html"
# 3) 右侧栏应当打开该文件（以截图 + DOM 文本为准）
```

`sessionId` 可以从界面里取：`JSON.parse(localStorage.getItem('dsh.sessions.current')).sessionId`。

## 依赖的内部 API（DSH 升级后按这个清单复查）

| 用到什么                                                    | 出处                          | 变了会怎样                                        |
| ----------------------------------------------------------- | ----------------------------- | ------------------------------------------------- |
| `ctx.tools.register(definition)` 的四项要求                 | `@deepseek-ai/dsh-tools`      | 工具注册不上 → **kit 的 `defineTool` 改一处**     |
| `ctx.webServer.register({kind:'exact',path,handler})` + SSE | `dsh-client-hmr` 的同一套写法 | 频道挂不上 → 面板不弹（不报错）                   |
| `ctx.fs.lstat(path,{cwd},signal)`                           | `@deepseek-ai/dsh-fs`         | 校验失败 → 工具报错                               |
| `dsh-resource://file/session/<id>/<path>`                   | `dsh-util-workspace-path`     | 面板空白/报错 → **kit 的地址函数改一处**          |
| `ctx.sidebarRight.openResource(address,{params})`           | `dsh-client-ui-sidebar-right` | 面板不弹（浏览器控制台一条 warn）                 |
| `window.__ModuleLoader__.load({id,factory})`                | `dsh-client-*` 的产物形状     | 浏览器半边加载不上 → **kit 的 wrapClient 改一处** |
