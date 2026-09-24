# 发布路线（2FA、账号安全冻结、2027 年那道坎）

## 结论先放前面

| 阶段             | 谁执行                  | 需要什么                                                                                   | 为什么这么选                                                            |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **首发 0.1.0**   | **本地**（一次）        | ① 账号**不在**安全冻结期；② 一个 `@yozica` 的 granular token（见下）或交互式 `npm publish` | Trusted Publisher 配在**包的 Settings** 里 ⇒ 包得先存在，首发只能本地发 |
| **之后的每一版** | **CI**（`release.yml`） | **什么都不用**：GitHub OIDC + npm Trusted Publishing                                       | 躲开 2027-01 的限制，且不用维护任何 secret                              |

**首发用哪个凭据**（二选一，都是发完就撤/不用留）：

- **交互式 `npm publish`**：在有 TTY 的终端里跑，npm 会打出
  `https://www.npmjs.com/auth/cli/<id>` 让你用安全密钥授权，然后把返回的一次性口令（**16 位**，
  不是 6 位 TOTP）用在同一个请求上重试。**只有安全密钥（无 TOTP）的账号走这条**。
- **granular token**，创建时必须选对两处（错一处就发不出去，而且报错会被掩盖成 `404 Not Found`）：
  - Permissions = **`Read and write (publish and stage)`** —— **不能**是 `stage only`
    （stage-only 的 token 不能直接发布新版本；而且**新包无法 stage**，所以首次发布直接 404）。
  - Select Packages = **`@yozica`**；`Bypass 2FA` 勾上可省掉每包一次密钥授权（2027-01 前仍有效）。

**刻意不做的**：不把任何 token 写进仓库 secret。bypass-2FA token 从 **2027-01** 起失去直接发布能力
（[官方 changelog](https://github.blog/changelog/2026-09-18-stage-only-npm-tokens-for-safer-automation/)），
而且 2026-07-31 起它已不能创建/删除 token、改包权限、改 trusted publishing
（[changelog](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)）。

## ⚠️ 账号安全冻结（72 小时只读）—— 2026-09-24 踩过的坑

npm 在检测到**安全敏感操作**后会把账号置为只读 72 小时：**改邮箱**或**用 recovery code 登录**
（2026-06-25 起对 high-impact 账号，2026-09-09 起对**所有账号**，
[changelog](https://github.blog/changelog/2026-09-09-npm-extends-recovery-code-security-holds-to-all-accounts/)）。

- 症状极难认：**读操作全正常**（`npm whoami`、`npm access list packages`、`npm view` 都 200，
  甚至 publish 的 2FA 挑战也会正常返回），但**所有写操作**（publish、`npm trust`、创建 token、
  改可见性）失败，且被掩盖成 `404 {"error":"Not found"}`——**不是**权限、不是 scope、不是 token 类型。
- 时长：**72 小时，自动解除**，不需要提工单；期间仍可登录、装包、看设置。
- 怎么确认：npmjs.com 页面顶部会有红条
  `Your account has been temporarily suspended due to a recent security-sensitive action.`
- 如果**并没有**用 recovery code 登录却被冻结 ⇒ 属于异常，立刻联系 [npm Support](https://www.npmjs.com/support)。
- 结论：**冻结期内不要反复重试**（每次都只是同一个 404），等解冻再发。

## 首发（本地，一次，解冻后）

```bash
cd ~/Desktop/dsh/dsh-plugins
pnpm build && pnpm test:only && pnpm check:dist        # 发布前三条硬检查

# 方式 A：granular token（写进一个临时文件，别进仓库、别进聊天）
read -rs T && printf '//registry.npmjs.org/:_authToken=%s\n' "$T" > ~/.npmrc-publish \
  && chmod 600 ~/.npmrc-publish && unset T
node scripts/publish-local.mjs --userconfig ~/.npmrc-publish   # 两个包，按 0.1.0 发；token 不发到别处

# 方式 B：交互式（只有安全密钥时）
#   在**有 TTY 的终端**里：cd packages/kit && npm publish ./yozica-dsh-plugin-kit-0.1.0.tgz \
#     --access public --registry https://registry.npmjs.org
#   然后在浏览器里用安全密钥授权（npm 会打印 authUrl）
```

发完立即验证：

```bash
npm view @yozica/dsh-plugin-kit version --registry=https://registry.npmjs.org
npm view @yozica/dsh-plugin-reveal version --registry=https://registry.npmjs.org
dsh plugin --profile web add @yozica/dsh-plugin-reveal   # 真装一次（kit 会从 npmjs 自动带上）
```

> `pnpm pack`（不是 `npm pack`）才会把依赖里的 `workspace:*` 换成真实版本号 —— 见
> `scripts/pack-all.mjs` 的注释。`scripts/publish-local.mjs` 内部就是这么打的包。

## 之后：切到 Trusted Publishing（OIDC）

**① 在 npmjs 上给两个包各配一次**（包页面 → Settings → Trusted Publisher → GitHub Actions）：

| 字段                 | 填什么                                           |
| -------------------- | ------------------------------------------------ |
| Organization or user | `yozica`                                         |
| Repository           | `dsh-plugins`                                    |
| Workflow filename    | `release.yml`                                    |
| Environment          | 留空（除非将来用 GitHub Environment 做人工卡口） |

**② `release.yml` 已经是 OIDC 形态**（`permissions: id-token: write`，不设 `NODE_AUTH_TOKEN`），
配好 trusted publisher 后什么都不用改。

**③ 以后发版**（人都只做本地这三步，CI 负责发布）：

```bash
pnpm changeset          # 写片段
pnpm version            # 汇总版本
pnpm changeset tag && git push --follow-tags
```

## 如果哪天必须回退

- **stage-only 路线**（npm 官方主推）：token 选 `Read and write (stage only)`，
  发布改成 `npm stage publish`，再由带 2FA 的人在 npmjs 的 **Staged Packages** 页或
  `npm stage approve <stage-id>` 批准。代价：每次发布都要人批一次。
- **token + `NODE_AUTH_TOKEN`**：只在 CI 临时救急用，2027-01 起失效；且注意冻结期/权限两件事，
  失败时先按上面的红条自查。
