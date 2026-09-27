---
---

包名改名：`@yozica/dsh-plugin-paths` → **`@yozica/dsh-plugin-panel-body`**（包目录 `packages/paths/` → `packages/panel-body/`）。

原来那个名字描述的是**症状**（"路径可点"），而这个插件的实际职责是**接管侧栏右侧面板里文档正文的渲染**
（注册 `documentPreviews` 的 body + 挂进 `sidebar.right.tab.document` 槽位），路径可点只是它在 Markdown
正文里做的一件事。"panel-body" 同时说清了**范围**（侧栏面板）与**职责**（正文），也留出了扩展余地。

**现在改是零迁移成本** —— 包从来没发过 npm（0.1.0、无 tag），所以没有 deprecate 与升级路径的问题。

跟着改的：`cordis.patch.yml` 的 `id: paths` → `id: panel-body`、插件的 `name`、日志前缀、
HTML 桥的 `source`、统合包（`packages/suite`）的依赖与 patch、验收夹具
（`docs/fixtures/paths-demo.*` → `panel-body-demo.*`）以及仓内文档指针。

**没改**：`src/paths.ts`、`PathTarget`、`classifyPathToken`、`BARE_FILE_EXTENSIONS` 这些
**领域词**（它们说的就是"路径"这件事），以及 `docs/panel-path-links.md` 这个文档标题。
