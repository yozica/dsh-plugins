# @yozica/dsh-plugin-suite

**统合包**：一个 bundle 装齐 `reveal` + `panel-body`。它自己不写代码 —— 只有一个 manifest 和一份 patch，
把两个插件的 loader 条目一起插进来；两个插件作为它的依赖被带进去。

## 装

```bash
dsh plugin --profile web add @yozica/dsh-plugin-suite
```

装完**重启 dsh**（bundle 列表是启动时读的）+ **新开一个会话**（agent 工具面是会话启动时定的）。

## ⚠️ 与单包二选一，不要同时装

两种装法效果一样，**选一种**：

| 你想要       | 装什么                                   | `dsh.profile.bundles` 里出现                          |
| ------------ | ---------------------------------------- | ----------------------------------------------------- |
| 全都要       | `@yozica/dsh-plugin-suite`               | 只有 `…-suite` 一个（两个插件是它的依赖，不各自成层） |
| 只要其中一个 | `@yozica/dsh-plugin-reveal` 或 `…-panel-body` | 那个包自己                                            |

**为什么不能同时装**：统合包那层插的条目 id / name 与单包那份 patch **逐字一致**（都是 `reveal` / `panel-body`）。
同时装 ⇒ 同一个 id 在组合结果里出现两次 ⇒ dsh 启动时
`@deepseek-ai/cordis-plugin-loader` 直接
`throw new TypeError('duplicate loader entry id: …')`，**这个 profile 就起不来了**。

两个容易踩的点：

- **`--dump-config` 查不出这个问题**：它把两条都照印、退出码 0、没有任何警告。别拿它当判据，判据是**能不能起来**。
- **"让统合包把单包那层 disable 掉"这条路走不通**：重复 id 是**加载期**抛异常，而 disable 是后面那些覆盖规则的事 ——
  异常抛在轮到它们之前。所以这里只能靠"别同时装"，不是我们偷懒。
- 同理：**层序也救不了**。统合包与单包谁在后由 `dsh.profile.bundles` 的数组顺序决定，但两条都被收进去，抛异常与顺序无关。

真要同时留着两个包（例如在对比调试），只让其中一个**成层**：把另一个从 `dsh.profile.bundles` 里摘掉
（DSH Console 插件页的「临时停用」就是这个动作）。

## 内容

| 带进来的插件                | 干什么                                                                   | 它的入口 |
| --------------------------- | ------------------------------------------------------------------------ | -------- |
| `@yozica/dsh-plugin-reveal` | 给 agent 一个 `reveal(path[, line])` 工具：在右侧栏把文件摊开给人看      | 工具     |
| `@yozica/dsh-plugin-panel-body`  | 侧栏内容里的文件路径可点（Markdown / HTML 正文接管；http(s) 交给浏览器） | 界面     |

细节看各自的 README：`packages/reveal/README.md`、`packages/panel-body/README.md`。

## 加插件进统合包

两步，别漏第二步：

1. `packages/suite/package.json` 的 `dependencies` 里加上那个包（`workspace:*`）；
2. `packages/suite/cordis.patch.yml` 的**同一个 `insert:` 块**里加一条 `- id` / `name`，
   `id` 与 `name` 抄那个包自己 `cordis.patch.yml` 里的原值（**必须逐字一致**，否则两边能同时生效、
   又或者覆盖关系对不上）。

## 为什么 `package.json` 里有几个空操作脚本

统合包**没有源码、也没有产物**（只有这份 README、一个 manifest、一份 patch），但仓根的两条命令是
`pnpm -r build` 与 `pnpm -r typecheck` —— 它们会对**每个** workspace 项目找同名脚本，缺了就直接失败。
所以 `build` / `typecheck`（以及打包前的 `prepack`）显式写成空操作，值为 `node -e ""`。
`scripts/check-dist.mjs` 也会跳过它（按 `dsh.bundle` 与 `dsh.client` 分开判），改成检查上面那份 patch
在不在、里面有没有插入条目。
