# dsh-plugins

自研的 DSH（DeepSeek Harness）插件，**多包一仓**（pnpm workspace）。每个插件是 `packages/` 下的一个包，
都按 DSH 的插件契约写：服务端半边（cordis 插件）+ 浏览器半边（客户端模块）+ 自带一层 `cordis.patch.yml`。

## 常用命令

```bash
pnpm install            # 装全部包的依赖（含 @deepseek-ai/dsh-tools 这类 DSH 内部包）
pnpm -r test            # 跑每个包的测试（纯逻辑单测，不需要 dsh 在跑）
pnpm pack               # 把所有包打成 tarball 到 .release/（给人装 / 准备发布）
```

## 装到 dsh 里（两种模式）

```bash
# 开发：link 装 —— 改源码立刻生效（依赖已由 pnpm install 装在仓库根）
dsh plugin --profile web add "$PWD/packages/<包名>"

# 发布/给人用：pack 出来的 tarball —— 真拷贝，依赖由 pnpm 装进 profile
pnpm run pack:all
dsh plugin --profile web add "$PWD/.release/<包名>-<版本>.tgz"
```

两种都是同一条 `dsh plugin` 命令，只是 pnpm 从哪儿取包。装完记得：**重启 dsh + 新开会话**
（工具面/客户端模块是会话启动时定下的）。

## 目录

```
packages/<包名>/       一个插件
  package.json         main（服务端）/ exports["./client"]（客户端）/ dsh.bundle / dsh.client
  cordis.patch.yml     把自己这行插进 loader（bundle 装法靠它）
  lib/index.js         服务端：export name / inject / apply
  lib/client.js        客户端：window.__ModuleLoader__.load({ id, factory })
  test/*.test.mjs      纯逻辑单测
docs/plugin-contract.md 插件契约与踩过的坑（新插件先读它）
scripts/               仓库级脚本（打包、兜底的 peer 链接）
```

## 加一个新插件

1. `cp -R packages/reveal packages/<新名>`，改 `package.json` 的 `name` / `description`；
2. 改 `cordis.patch.yml` 里的 `id` / `name`；
3. 写你要的两半（只写一半也合法：纯客户端或纯服务端）；
4. `pnpm install` → `pnpm -r test` → 按上面两种模式装进去试。

（脚手架脚本 `scripts/new-plugin.mjs` 还没做；现在照 `packages/reveal` 抄一遍就够，
真要批量做的时候再补 —— 这属于"以后"，别提前把结构做复杂。）
