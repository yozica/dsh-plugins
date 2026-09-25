# paths 插件手动验收

用 `reveal` 打开这个文件，按下面清单点一遍。**代码块里的路径不该可点**。

## 1. 行内代码：相对本文件所在目录

- `paths-demo.html` —— **裸文件名**（无目录）也认（扩展名在白名单里），点了右侧栏应出现预览
- `./paths-demo.css` —— 带 `./` 的写法，同样该可点
- `paths-demo.css:2` —— 裸文件名 + 行号也认

## 2. 行内代码：相对工作区根（先按本文件目录找，找不到再按工作区根）

- `dsh-plugins/packages/paths/src/plug.ts:30` —— 应跳到第 30 行附近
- `dsh-plugins/packages/paths/README.md`

## 3. Markdown 链接

- [指路径的链接（上一级目录）](../panel-path-links.md) —— 浏览器地址栏不该跳走，右侧栏换内容
- [指路径的链接（同目录）](paths-demo.md) —— **点了界面不变是预期**：地址与当前面板同一个 tab，
  侧栏只会聚焦已打开的那个 tab（侧栏按 `contentId` 去重）
- [指路径的链接（同目录的另一个文件）](paths-demo.html) —— 这个换了地址，右侧栏应该换内容
- [外链：example.com](https://example.com/) —— 应该交给系统浏览器
- 自动链接：<https://example.com/>

## 4. 代码块里不识别

```text
dsh-plugins/packages/paths/src/browser.ts:1
```

## 5. 行内代码但**不是**路径（不该可点）

裸文件名只在**扩展名进白名单**时才算路径，所以下面这些都不该可点：

- `const x = 1`
- `and/or`
- `process.env`、`console.log`、`React.Component`、`Math.max`、`arr.map`（属性名，不是文件）
- `1.5`、`v1.2.3`（数字，不是扩展名）
- `https://example.com/x.md`（是网页不是文件路径）
- `src/my file.ts`（带空格的路径仍不认，见 README 已知降级）

## 6. 打不开的路径

- `dsh-plugins/packages/paths/src/missing.ts` —— 点了右侧栏应显示"读不到/不存在"，而不是白屏或乱跳
