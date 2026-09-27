---
'@yozica/dsh-plugin-suite': minor
'@yozica/dsh-plugin-kit': patch
'@yozica/dsh-plugin-paths': patch
'@yozica/dsh-plugin-reveal': patch
---

新增统合包 `@yozica/dsh-plugin-suite`：一个 bundle 装齐 `reveal` + `paths`。它自己不写代码 ——
一个 manifest 加一份 patch，在同一个 `insert:` 块里把两个插件的 loader 条目一起插进来，
两个插件作为它的依赖被带进去。于是「全都要」只需装一个包，「只要一个」仍旧装那个单包。

**两者二选一，不要同时装**：统合包插的条目 id / name 与单包那份 patch 逐字一致，同时装会让同一个 id
进两次，而 `@deepseek-ai/cordis-plugin-loader` 在加载期是
`throw new TypeError('duplicate loader entry id: …')` —— 那个 profile 直接起不来。
这条路"加防护"走不通（异常抛在覆盖规则生效之前），所以写进文档防呆，并且
`--dump-config` 查不出这个问题（照印两条、退出码 0），判据是能不能起来。

顺带修 `scripts/check-dist.mjs`：它原来把「有 `dsh` 字段」等同于「是插件」，于是统合包会被误报成
缺 `lib/index.js`。现在按 `dsh.bundle` 与 `dsh.client` 分开判，统合包检查的是那份 patch 文件在不在、
里面有没有插入条目。
