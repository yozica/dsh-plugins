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

## 发布：人打标签触发，**CI 执行**

> 完整路线（含首发怎么做、2FA、以及 2027-01 npm 政策的应对）见 [`docs/publishing.md`](docs/publishing.md)。
> 一句话：**首发在本地带 OTP 发一次**（Trusted Publisher 要先有包才能配），**之后全部交给 CI 的 OIDC**，不需要任何 token。

```bash
# ① 开发时：每个要发出去的改动带一个片段
pnpm changeset                      # 选包 + patch/minor/major + 写一句人话

# ② 想发版时：汇总版本 → 提交 → 打标签 → 推（推标签即触发 CI 发布）
pnpm version                        # 改各包版本号、删掉已汇总的片段
git commit -am "chore: version packages"
pnpm changeset tag                  # 生成形如 @yozica/dsh-plugin-reveal@0.1.1 的标签
git push --follow-tags
```

推上去之后 `.github/workflows/release.yml` 会：干净环境 install → **build → test → check:dist**
→ 检查 `NPM_TOKEN` → `pnpm changeset publish`（**只发 registry 上还没有的版本**，多包各自版本号）。

一次性配置：仓库 Settings → Secrets and variables → Actions 新增 **`NPM_TOKEN`**，
内容是 npm 的 **Automation / Granular（bypass 2FA）** token，对 `@yozica` scope 有发布权限 ——
开了 2FA 的账号不能用普通 token 发布，这是 npm 的规矩。

本地想先看会发什么（不真发）：

```bash
cd packages/reveal && npm publish --dry-run --access public
```

（scoped 包默认 restricted，`--access public` 必须 —— 各包 `publishConfig` 里已写死。）

## 发布前的三条硬检查

```bash
pnpm build && pnpm test:only && pnpm check:dist    # 产物形状不对就别发（CI 里也是这三条）
```

## 结构

```
packages/kit/        公共件：工具定义构造器、地址语法、SSE 频道、客户端包装、能力断言（零 @deepseek-ai 依赖）
packages/reveal/     第一个插件：reveal(path) —— 在右侧栏打开文件给人看
packages/paths/      第二个插件：侧栏里的文件路径可点（Markdown / HTML 正文接管）
packages/suite/      统合包：一个 bundle 装齐 reveal + paths（**与单包二选一**，见它的 README）
scripts/             build-client（esbuild + loader 包装）/ check-dist / install-dev / pack-all
docs/                架构、契约、交接
```

## 统合包与单包：二选一

`@yozica/dsh-plugin-suite` 只是把 `reveal` + `paths` 的 loader 条目**一起插进一个层**，两个插件是它的依赖。
所以「全都要」装统合包、「只要一个」装那个单包 —— 但**不要同时装**：统合包插的条目 id 与单包那份 patch 逐字一致，
同时装会让同一个 id 进两次，dsh 启动时 `cordis-plugin-loader` 会
`throw new TypeError('duplicate loader entry id: …')`。
（`--dump-config` 查不出来：它照印两条、退出码 0。判据是**能不能起来**，不是 dump 绿不绿。）

## 加一个新插件

1. `cp -R packages/reveal packages/<你的包>`，改 `package.json` 的 `name`（`@yozica/dsh-plugin-<名>`）与 `description`；
2. 改 `cordis.patch.yml` 里的 `id` / `name`；
3. 写两半：`src/index.ts`（服务端：`export name / inject / apply`）+ `src/browser.ts`（浏览器：`export name / inject / apply`，只用 kit 的 `/client`）；
4. `pnpm install`（建 workspace 链接）→ `pnpm build` → `pnpm -r test` → `pnpm check:dist`；
5. `pnpm install:dev packages/<你的包>` 装进 dsh 试；验证清单见 `packages/reveal/README.md` 的"验证"段。
