# dsh-plugins 架构提案（v0.1，待裁定）

> 这份文档回答三件事：**这个项目会长到多大**、**框架要先解决什么**、**哪些岔路口现在必须定**。
> 裁定之后我会把仓库删掉重建（同一个名字 `dsh-plugins`），按这里定下来的结构落地。

## 0. 一句话定位

**自研 DSH（DeepSeek Harness）插件的唯一产地**：一仓多包、一份契约、一套验证、一条发布路径。

## 1. 能力地图：DSH 插件到底能长到多大

今天在 0.1.5-rc.2 上实际摸过的（✅ = 我跑通过；🟡 = 见过 API 没验证；⬜ = 没碰过）：

| 能加什么 | 靠什么 | 状态 |
| --- | --- | --- |
| **agent 工具**（模型能调的动作） | `ctx.tools.register(defineTool)` | ✅ `reveal` |
| **浏览器界面**：右栏面板/标签、页面、槽位、命令 | 客户端插件 + `ctx.slots` / `ctx.sidebarRight` / `ctx.layout` | ✅ 打开文件；🟡 自定义面板/页面 |
| **服务端服务与 HTTP 路由**（含 SSE 推送） | `ctx.webServer.register` + `ctx.effect` | ✅ 频道；🟡 自定义接口 |
| **会话数据**（投影 / 事件） | `ctx.sessionProjections` | 🟡 只见过读侧 |
| **agent 行为**（preset、system prompt、hooks、plan/goal） | `dsh-agent-*` / `dsh-hooks-*` | ⬜ 未碰，风险最高 |

**结论**：主战场是「**服务端工具 + 浏览器界面**」（前两行）。第三、四行是自然延伸；第五行（改 agent 行为）属于远期，**现在不设计、不承诺**。

## 2. 会被"数量"压垮的三件事（框架必须先解决）

1. **DSH 内部 API 会漂移**（rc 阶段）：`defineTool` 的 schema 形状、`ctx.sidebarRight.openResource`、
   `dsh-resource://` 地址语法、SSE/客户端 loader 包装 —— 今天写一个插件就撞了 4 处。
   插件一多，**每一处漂移都会变成 N 个插件的返工**。
2. **每个插件都要重复的样板**：客户端 `window.__ModuleLoader__.load` 包装、`cordis.patch.yml`、
   `dsh.bundle`/`dsh.client` 清单、安装/卸载说明、"依赖了哪些内部 API"的复查表。
3. **验证成本**：今天 `reveal` 的端到端是我**手工**做的（起 dsh → CDP 连浏览器 → 推一帧 → 看面板开没开）。
   手工步骤不可持续，第二个插件就会开始"凭感觉"。

## 3. 提议的仓库结构

```
dsh-plugins/
  package.json            private 根：workspace + 脚本（test / lint / e2e / pack:all / install:dev）
  pnpm-workspace.yaml
  tsconfig.base.json      统一 TS 配置（纯逻辑包用得上）
  .github/workflows/ci.yml   pnpm -r test + lint + typecheck（不自动发布）
  .changeset/             版本与 CHANGELOG（沿用你在 dsh-console 的习惯）
  docs/
    architecture.md       这一份
    plugin-contract.md    DSH 插件契约（今天核对出来的，含"内部 API 复查表"）
    decisions/            每个拍板一条记录（为什么这么定）
  packages/
    kit/                  ★ 内部 API 的唯一封装点（下面 §4-B 定它的厚薄）
    reveal/               第一个插件（现有代码迁入）
  templates/
    plugin/               新插件骨架：清单 + 两半 + 单测 + README（`cp -R` 即用）
  scripts/
    e2e.mjs               ★ 端到端验证：起 dsh → 连浏览器 → 跑场景 → 出结论
    install-dev.mjs       把某个包 link 进 profile（开发用）
    pack-all.mjs          把包打成 tarball 到 .release/
    link-peers.mjs        兜底（源上装不了内部包时）
```

## 4. 已裁定的四件事

### A. 包名：`@yozica/dsh-plugin-*`，只发**官方源**（npmjs.com）

个人账号可以在公共源拥有 scope（与 npm 用户名同名，或免费建一个同名 org）。发布要点：

- `npm whoami` 确认登录身份；scope 必须是**你拥有的**（同名用户名或你建的 org）；
- **scoped 包默认是 restricted**，发布必须带 `--access public`（或在各包 `publishConfig` 里写死 `access: "public"`）；
- 开了 2FA 的账号发布要带一次性码（`npm publish --otp=<码>`）；
- **不需要**内网源、也不需要内网包（见下面 C 的"零依赖"结论）。

### B. `packages/kit`：薄，但它是**漂移防火墙**

只收"依赖 DSH 内部实现"的东西，而**不是** UI 组件库：

| kit 里放什么 | 为什么 |
| --- | --- |
| **自造的 tool 定义构造器**（等价于 `defineTool`）+ 参数校验 | 让插件**不 import `@deepseek-ai/dsh-tools`** —— 这是"能发官方源、谁都能装"的前提（见 §4-C） |
| `dsh-resource://` 地址语法（build/parse） | 唯一被多个插件复用的纯逻辑，可单测 |
| SSE 频道帮助函数（服务端注册 + 客户端订阅） | 服务端→浏览器的推送样板 |
| 客户端 loader 包装（构建期用，见 D） | 官方插件都是构建产物，我们也要 |
| **DSH 版本断言** | 启动时比对，不匹配就在日志里说清楚（**不崩**） |
| 自己的最小类型（ctx / exec / 工具定义形状） | 我们不依赖 DSH 的 `.d.ts`，类型也不跟着内网包走 |

**规则**：UI 片段、设置读写、日志这些**等第二个插件真用到再上移**（"两处重复"才抽）。kit 的**表面要小、语义要稳**，因为所有插件都挂在它上面。

### C. 零 `@deepseek-ai` 依赖（查证过，成立）

`ctx.tools.register(definition)` 对 definition 的要求就四条：`name`、`output{schema,render,presentationMeta?}`、`timeoutMs?`、`execute`；`parameters` 与 `output.schema` 都是**标准 JSON Schema**（`defineTool` 只是把紧凑写法转成它、并在执行前校验参数）。所以：

- kit 自己造这份定义 → 插件源码里**没有** `import … from '@deepseek-ai/…'`；
- 于是包可以发到公共源，**谁的 DSH 都能装**（客户端清单里的 `@deepseek-ai/dsh-client-ui-*` 只是"宿主包名"，不装）；
- 代价：这份定义形状是我们**照着 0.1.5-rc.2 抄的**，DSH 改了我们得跟着改 —— 这正是把它关在 kit 里的原因（改一处）。

### D. 客户端半边：**上手就用 esbuild 构建**（不手写包装了）

源码写标准 ESM/TS（`src/client/`），构建脚本用 esbuild 打成 `lib/client.js`，外面套 `window.__ModuleLoader__.load({ id, factory })`；
`@deepseek-ai/dsh-client-*` 这类宿主包在构建时标记为 **external**（在 factory 里变成 `require(...)`，由宿主的 loader 提供）。

理由：手写包装今天能过，但一旦要用 npm 依赖 / 拆多文件 / 写 JSX 就得返工；esbuild 只多一个脚本 + 一个 devDependency，
而且和官方插件的产物形状一致 —— **一次做对，后面不用迁**。

### 重建方式（已定）

先把新框架在本地搭好、跑通测试与 e2e，**再删库同名重建、一次推上去**（旧对象随删库清掉，名字与 URL 不变）。

## 5. 路线图

| 阶段 | 交付 | 判定标准 |
| --- | --- | --- |
| **1（这次做）** | 框架 + `reveal` 迁入 | `pnpm -r test`、`pnpm e2e` 两条命令能跑出结论；新插件 `cp -R templates/plugin` 即可起 |
| **2** | 第二个插件（用真实需求挑） | 若需要改 `kit`，说明阶段 1 抽得不对——这是对框架的验收 |
| **3** | 对外发布与文档 | 一条 `dsh plugin add <包名>` 装得上；每个插件有安装/卸载/验证说明 |

## 6. 明确不做（避免过度设计）

- ❌ 插件市场 / 可视化商店 / 索引站
- ❌ 多版本 DSH 并存的兼容层（只钉当前版本 + 启动断言）
- ❌ 自建 registry（除非将来真要离线/内网分发）
- ❌ 提前抽 UI 组件库、提前做 i18n、提前支持 Windows 特例（撞到再说）

## 7. 重建的方式（你点头我就做）

1. 你在 GitHub 上删掉 `yozica/dsh-plugins`（我的 token 没有 `delete_repo`）；
2. 我按这份结构重排本地仓（`kit` 骨架 + 模板 + 脚本 + CI + 文档 + `reveal` 迁入），
   本地跑通 `pnpm -r test` 与 `pnpm e2e`；
3. 用 API 以**同名**重建私仓并推上去 —— 旧对象随删库一起消失，名字不变，URL 不变。
