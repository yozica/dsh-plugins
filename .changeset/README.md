# 变更片段

每个要发出去的改动带一个片段（`pnpm changeset`）。发版时：

```bash
pnpm changeset            # 选包 + 级别（patch/minor/major）+ 写一句人话
pnpm version              # 汇总：改各包版本号、删掉已汇总的片段
pnpm build && pnpm -r publish --access public   # 发布（或 pnpm release）
```

- `changelog: false`：本仓的 CHANGELOG 不自动生成（真要写就手写进各包 README 的"变更"段）；
- `access: public`：scoped 包必须公开，否则 npm 拒发；
- **CI 不发布** —— 发布是人的动作。
