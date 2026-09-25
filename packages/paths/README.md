# @yozica/dsh-plugin-paths

让 **DSH 侧栏里看到的东西可点**：Markdown / HTML 内容里的**文件路径**点了在侧栏打开，
**http(s) 链接**点了交给浏览器。

与 [`@yozica/dsh-plugin-reveal`](../reveal/README.md) 的分工：

| 包              | 负责                                                |
| --------------- | --------------------------------------------------- |
| `reveal`        | **agent 主动**把东西摊到侧栏（工具 → 右栏打开资源） |
| `paths`（本包） | 侧栏里**内容自己**可点（接管 md / html 的 body）    |

## 状态

**探针阶段。** 当前只注册 body、验证"接管"这条路通不通（组件只打一行日志、返回 `null`），
正式渲染（Markdown 渲染 + HTML iframe 桥）还没写。机制、决定、实现清单与未决项：
[`docs/panel-path-links.md`](../../docs/panel-path-links.md)。

## 为什么必须接管（而不是补官方那套）

官方 HTML 预览把内容放进 `sandbox="allow-scripts"` 的 iframe（没有 `allow-popups`），
点击在 iframe 内就被丢掉，外壳收不到、也注入不了脚本；Markdown 那边则会把指路径的链接
当成普通文本。所以两种内容都由本包接管，自己渲染，再自己决定点击去哪。

## 安装（本地开发）

```bash
dsh plugin --profile web add link:/绝对路径/dsh-plugins/packages/paths
```

改代码后：`pnpm build` → **重启 dsh**（浏览器半边在页面加载时注入）。
