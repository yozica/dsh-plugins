# AGENTS.md — 在这个仓库里干活

自研 **DSH（DeepSeek Harness）插件**的多包仓：`packages/kit`（公共件）+ `packages/reveal` + `packages/panel-body`。
每个插件都是**双面插件**：服务端半边（agent 工具 / 路由）+ 浏览器半边（界面），两半用一条 SSE 频道连起来。

**先读 [`docs/handoff.md`](docs/handoff.md)**：它的 §0 是**当前进度快照**（做到哪了、发了没有、卡在哪、
换环境后第一步），§1–§9 是开工前的框架裁定与 DSH 插件契约（仍然有效）。再往下：
[`docs/architecture.md`](docs/architecture.md)（裁定）、[`docs/plugin-contract.md`](docs/plugin-contract.md)（真机核对的契约）、
[`docs/publishing.md`](docs/publishing.md)（首发怎么做、npm 账号安全冻结那件事、2027-01 的 token 政策）。

## 硬约定（改之前先看，别重新讨论）

- **插件零 `@deepseek-ai` 依赖**（决定 C）：要 DSH 的内部能力，就在 `packages/kit` 里再实现一份。
  这是"能发公共源、谁的 DSH 都能装"的前提，也顺带消灭了 `link:` 装法解析不到内部包那个坑。
- 包名 `@yozica/dsh-plugin-*`、只发官方源、`publishConfig.access = "public"`（决定 A）。
- 客户端半边由 esbuild 打成 `lib/client.js` + loader 包装（`scripts/build-client.mjs`），宿主包标 external（决定 D）。
- **测试跑的是构建产物** ⇒ 先 `pnpm build`（`pnpm test` 已经包含构建，只跑测试用 `pnpm test:only`）。
- **只动本仓**：`dsh-console` 是另一个项目。提交里不写公司信息、不写本机绝对路径与用户名；
  提交身份用仓内 `git config --local`（这台机器的全局身份是另一个）。
- **本仓 `main` 上没有任何服务端强制** —— 走 PR 是我们自己的约定，不是 GitHub 拦的。
  实测（2026-09-27）：`GET /repos/yozica/dsh-plugins/branches/main/protection` 返回
  **HTTP 403 `Upgrade to GitHub Pro or make this repository public to enable this feature.`** ——
  这个仓是 **private + 免费套餐**，分支保护与 rulesets 都不可用（`dsh-console` 是 public，所以那边是真的有保护）。
  推论：**别拿"服务端会拦"当安全网** —— 直推 `main` 是推得上去的，唯一挡住你的是自己的纪律与 CI 的绿灯。
- 改了包行为就带一个 changeset 片段（`pnpm changeset`）；发布由**人打标签**触发 CI（`release.yml`），
  **不要**在本地直接 `pnpm publish`（首发那一次除外，见 `docs/publishing.md`）。

## 命令

```bash
pnpm install            # 装全部包的依赖（仓根）
pnpm build              # kit tsc → 各插件 tsc + esbuild（浏览器半边）
pnpm test               # = build + 各包单测；pnpm test:only 只跑测试
pnpm typecheck          # 各包 tsc --noEmit
pnpm check:dist         # 产物形状：宿主认不认（服务端导出 / loader 包装 / host require）
pnpm e2e                # 端到端：真起 dsh + 真开 headless Chrome，断言"面板真的打开"
pnpm format:check       # Prettier（改完用 pnpm format 写回）
pnpm install:dev packages/reveal   # 把某个包 link 进 profile（开发用）
pnpm pack:all           # 打 tarball 到 .release/（给人装 / 准备发布）
```

CI（`.github/workflows/ci.yml`，PR 与 main 都跑）：`pnpm install --frozen-lockfile` → `build` →
`test:only` → `typecheck` → `check:dist` → `format:check`。**本仓的 CI 不检查 changeset 片段**，
但按上面的约定该带还是要带。
