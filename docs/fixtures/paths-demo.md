# paths 插件手动验收

用 `reveal` 打开这个文件，按下面清单点一遍。**代码块里的路径不该可点**。

## 1. 行内代码：相对本文件所在目录

- `paths-demo.html` —— 同目录 HTML，点了右侧栏应出现预览（样式生效 + 里面也能点）
- `./paths-demo.css` —— 带 `./` 的写法，同样该可点

## 2. 行内代码：相对工作区根（先按本文件目录找，找不到再按工作区根）

- `dsh-plugins/packages/paths/src/plug.ts:30` —— 应跳到第 30 行附近
- `dsh-plugins/packages/paths/README.md`

## 3. Markdown 链接

- [指路径的链接（上一级目录）](../panel-path-links.md) —— 浏览器地址栏不该跳走，右侧栏换内容
- [指路径的链接（同目录）](paths-demo.md)
- [外链：example.com](https://example.com/) —— 应该交给系统浏览器
- 自动链接：<https://example.com/>

## 4. 代码块里不识别

```text
dsh-plugins/packages/paths/src/browser.ts:1
```

## 5. 行内代码但**不是**路径（不该可点）

- `const x = 1`
- `and/or`
- `a.ts`（裸文件名：行内代码不认，链接才认）
- `https://example.com/x.md`（是网页不是文件路径）

## 6. 打不开的路径

- `dsh-plugins/packages/paths/src/missing.ts` —— 点了右侧栏应显示"读不到/不存在"，而不是白屏或乱跳
