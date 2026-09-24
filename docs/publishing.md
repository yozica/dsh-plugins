# 发布路线（含 2FA 与 2027 年的那道坎）

## 结论先放前面

| 阶段             | 谁执行                         | 需要什么                                             | 为什么这么选                                                                              |
| ---------------- | ------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **首发 0.1.0**   | **本地**（你我任一人，带 OTP） | 账号 2FA（已开）+ `--otp=<6 位码>`                   | Trusted Publisher 是在**包的 Settings** 里配的，所以要先有包 —— 首发只能靠 token 或本地发 |
| **之后的每一版** | **CI**（`release.yml`）        | **什么都不用**：GitHub OIDC + npm Trusted Publishing | 提前躲开 2027-01 的限制，且不用维护任何 secret                                            |

**刻意不做的**：不为首发建 `NPM_TOKEN`（Automation / bypass-2FA token）。npm 计划 **2027 年 1 月**起禁止
bypass-2FA token 直接发布（[官方 changelog](https://github.blog/changelog/2026-09-18-stage-only-npm-tokens-for-safer-automation/)），
建了也是短期方案；而且开了 2FA 之后，本地带 OTP 发一次的成本就是"输入 6 位数字"。

## 首发（本地，一次）

```bash
cd ~/Desktop/dsh/dsh-plugins
pnpm build && pnpm test:only && pnpm check:dist     # 发布前三条硬检查
pnpm changeset publish --otp=<你的 6 位码>           # 发布两个包（只发 registry 上还没有的版本）
```

发完立即验证：

```bash
npm view @yozica/dsh-plugin-kit version --registry=https://registry.npmjs.org
npm view @yozica/dsh-plugin-reveal version --registry=https://registry.npmjs.org
dsh plugin --profile web add @yozica/dsh-plugin-reveal   # 真装一次（kit 会从 npmjs 自动带上）
```

> `pnpm changeset publish` 走的是 `pnpm publish`，它会把依赖里的 `workspace:*` 换成真实版本号
> （`npm pack` 不会 —— 这是我们踩过的坑，见 `scripts/pack-all.mjs` 的注释）。

## 之后：切到 Trusted Publishing（OIDC）

**① 在 npmjs 上给两个包各配一次**（包的页面 → Settings → Trusted Publisher → GitHub Actions）：

| 字段                 | 填什么                                           |
| -------------------- | ------------------------------------------------ |
| Organization or user | `yozica`                                         |
| Repository           | `dsh-plugins`                                    |
| Workflow filename    | `release.yml`                                    |
| Environment          | 留空（除非将来用 GitHub Environment 做人工卡口） |

**② 把 `release.yml` 的发布那两步换成 OIDC**（把 token 相关的删掉）：

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # ← OIDC 必需
    steps:
      # …checkout / setup-node / corepack / install / build / test:only / check:dist 都不变…
      - name: 发布（Trusted Publishing，无需 token）
        run: pnpm changeset publish
        # 不再需要 NODE_AUTH_TOKEN / NPM_TOKEN；npm 认 GitHub 的 OIDC 身份
```

**③ 以后发版**（和现在一样，只是不再需要任何 secret）：

```bash
pnpm changeset          # 写片段
pnpm version            # 汇总版本
git commit -am "chore: version packages"
pnpm changeset tag && git push --follow-tags
```

## 如果哪天必须回退

- 临时用 token：建一个 **Automation** token 填 `NPM_TOKEN`，把 OIDC 那两步换回 `NODE_AUTH_TOKEN`；
  注意这条路 2027-01 起会失效。
- 或者用 **stage-only token + `npm stage publish`**（需要 2FA 已开、npm CLI ≥ 11.15 / Node ≥ 22.14），
  代价是每次发布要有人带 2FA 批准一次。
