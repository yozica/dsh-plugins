# dsh-plugins

自研的 **DSH（DeepSeek Harness）插件**，多包一仓。每个插件都是 DSH 的**双面插件**：
服务端半边（agent 工具 / 路由）+ 浏览器半边（界面），两半之间用一条 SSE 频道连起来。

- 框架与裁定： [`docs/architecture.md`](docs/architecture.md)
- DSH 插件契约（真机核对）： [`docs/plugin-contract.md`](docs/plugin-contract.md)
- 交接/背景： [`docs/handoff.md`](docs/handoff.md)

## 命令

```bash
pnpm install                 # 装全部包的依赖（仓根）
pnpm build                   # kit tsc → 各插件 tsc + esbuild（浏览器半边）
pnpm test                    # = build + 各包单测（测试跑的是产物，所以先构建；只想跑测试用 test:only）
pnpm test:only               # 只跑各包单测（需要先 build 过）
pnpm check:dist              # 产物形状：宿主认不认（服务端导出 / loader 包装 / host require）
pnpm e2e                     # 端到端：真起 dsh + 真开 headless Chrome，断言"面板真的打开"（见下）
pnpm format / format:check   # Prettier

pnpm install:dev packages/reveal   # 把一个包 link 进 profile（开发用）
pnpm pack:all                      # 打 tarball 到 .release/（给人装 / 准备发布）
```

## 发布（官方源 npmjs.com）

```bash
# 一次性：登录官方源，并让这个 scope 走官方源（写在 ~/.npmrc，本机，不进仓）
npm login --registry=https://registry.npmjs.org
echo '@yozica:registry=https://registry.npmjs.org/' >> ~/.npmrc

# 发布（各包 publishConfig 已写死 access: public）
pnpm -r publish --access public          # 开了 2FA 再加 --otp=<码>
npm publish --dry-run --access public    # 发之前先试跑：只看会发什么，不真发
```

- scoped 包默认是 restricted，`--access public` **必须**；
- 各包的 `prepack` 会自动 `pnpm build`，所以发出去的一定是构建产物
  （`lib/` 虽在 `.gitignore` 里，但按 `files` 会进包）；
- **CI 不发布** —— 发布由人点头后手动跑；
- 版本与 CHANGELOG 用 changesets（待接入，见 `docs/architecture.md` 的阶段 1 第 4 步）。

## 发布前的三条硬检查

```bash
pnpm build && pnpm -r test && pnpm check:dist    # 产物形状不对就别发
```

## 三层验证（都是命令，不靠"看起来在跑"）

| 层            | 命令              | 跑的是什么                                                                                                      |
| ------------- | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| 纯逻辑 + 契约 | `pnpm -r test`    | `src/`：地址语法、工具定义、SSE 频道、用假 ctx 断言"注册了什么"                                                 |
| 产物形状      | `pnpm check:dist` | `lib/`：服务端导出 `name/inject/apply`；浏览器边是 loader 包装且 **host require 为空**                          |
| 端到端        | `pnpm e2e`        | **真起 dsh + headless Chrome**：客户端半边进模块图 → 推一帧 → 右侧栏真的打开该文件（留档截图在 `.verify/e2e/`） |

`pnpm e2e` 会自己把插件装进 profile（并清掉历史遗留的旧包名 —— 两个包插同一个 `id` 会让 dsh 起不来）、
用独立端口起 dsh、跑完清进程；`--keep` 可以留着看现场，`--port` 换端口。

## 结构

```
packages/kit/        公共件：工具定义构造器、地址语法、SSE 频道、客户端包装、能力断言（零 @deepseek-ai 依赖）
packages/reveal/     第一个插件：reveal(path) —— 在右侧栏打开文件给人看
scripts/             build-client（esbuild + loader 包装）/ check-dist / install-dev / pack-all
docs/                架构、契约、交接
```

## 加一个新插件

1. `cp -R packages/reveal packages/<你的包>`，改 `package.json` 的 `name`（`@yozica/dsh-plugin-<名>`）与 `description`；
2. 改 `cordis.patch.yml` 里的 `id` / `name`；
3. 写两半：`src/index.ts`（服务端：`export name / inject / apply`）+ `src/browser.ts`（浏览器：`export name / inject / apply`，只用 kit 的 `/client`）；
4. `pnpm install`（建 workspace 链接）→ `pnpm build` → `pnpm -r test` → `pnpm check:dist`；
5. `pnpm install:dev packages/<你的包>` 装进 dsh 试；验证清单见 `packages/reveal/README.md` 的"验证"段。
