# @yozica/dsh-plugin-kit

自研 DSH 插件的公共件。**它只做一件事**：把"依赖 DSH 内部实现"的部分收在这里，
让插件本身**零 `@deepseek-ai` 依赖** —— 于是包能发到公共源、谁的 DSH 都能装；
DSH 内部 API 变了，也只改这一处。

## 表面

| 从哪进                          | 导出                                                                     | 干什么                                                                             |
| ------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `@yozica/dsh-plugin-kit`        | `defineTool`                                                             | 造宿主认得的工具定义（替代 `@deepseek-ai/dsh-tools` 的 `defineTool`）+ 参数校验    |
|                                 | `sessionFileAddress` / `fileAddressFor` / `isAbsoluteWorkspacePath`      | `dsh-resource://file/…` 地址语法（工作区外的绝对路径**保留前导斜杠**）             |
|                                 | `createSseChannel` / `sseData` / `isLoopback`                            | 服务端 → 浏览器 的 SSE 频道                                                        |
|                                 | `requireServerServices` / `requireClientServices` / `DSH_TESTED_VERSION` | 能力断言：缺服务只**告警**，不把会话搞崩                                           |
|                                 | 类型 `ServerContext` / `ClientContext` / `ToolDefinition` / `ToolExec` … | 我们自己声明的最小宿主形状（不依赖 DSH 的 `.d.ts`）                                |
| `@yozica/dsh-plugin-kit/client` | `subscribeSse` / `openResource`                                          | 浏览器半边：订阅频道、请右栏打开资源（失败只告警）                                 |
| `@yozica/dsh-plugin-kit/build`  | `wrapClient`                                                             | 构建期：把 esbuild 的 CJS 产物包成 `window.__ModuleLoader__.load({ id, factory })` |

## 规矩（别提前抽）

**"两处重复"才上移**。UI 片段、设置读写、日志这些东西，等**第二个**插件真用到同一段再搬进来 ——
kit 的表面要小、语义要稳，因为所有插件都挂在它上面。

## 契约依据

这些形状是在 **DSH 0.1.5-rc.2** 上真机核对出来的（不是从文档抄的）。DSH 升级时按
`../../docs/plugin-contract.md` 末尾的"内部 API 复查表"逐条复查；改完跑 `pnpm -r test` + `pnpm check:dist`。
