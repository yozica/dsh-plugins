/**
 * 我们自己注入的一份样式。
 *
 * 接管 body 之后官方那套 Markdown 排版就没了，得自己兜住基本可读性；同时给"可点路径"
 * 一个能看出来的样子。颜色一律走 DSH 的 CSS 变量（`--dsw-alias-*`），跟随明暗主题。
 *
 * 注入方式与官方插件一致：一个带 `data-plugin-css` 的 `<style>`，同一份只插一次。
 *
 * @module @yozica/dsh-plugin-paths/styles
 */
export const STYLE_ID = '@yozica/dsh-plugin-paths/styles';

export const STYLES = `
.dsh-paths-document {
  padding: 12px 16px 24px;
  font-family: var(--dsw-font, var(--dsw-font-family, sans-serif));
  color: var(--dsw-alias-label-primary);
  line-height: 1.65;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.dsh-paths-document > :first-child { margin-top: 0; }
.dsh-paths-document h1, .dsh-paths-document h2, .dsh-paths-document h3,
.dsh-paths-document h4, .dsh-paths-document h5, .dsh-paths-document h6 {
  line-height: 1.3;
  margin: 20px 0 8px;
}
.dsh-paths-document h1 { font-size: 22px; }
.dsh-paths-document h2 { font-size: 18px; }
.dsh-paths-document h3 { font-size: 16px; }
.dsh-paths-document h4, .dsh-paths-document h5, .dsh-paths-document h6 { font-size: 14px; }
.dsh-paths-document p { margin: 10px 0; }
.dsh-paths-document ul, .dsh-paths-document ol { margin: 10px 0; padding-left: 24px; }
.dsh-paths-document li { margin: 4px 0; }
.dsh-paths-document blockquote {
  margin: 10px 0;
  padding: 2px 12px;
  border-left: 3px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.dsh-paths-document hr {
  border: none;
  border-top: 1px solid var(--dsw-alias-border-l1);
  margin: 16px 0;
}
.dsh-paths-document code {
  font-family: var(--dsw-font-mono, monospace);
  font-size: 0.92em;
}
.dsh-paths-document .dsh-paths-code {
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 4px;
  padding: 1px 5px;
}
.dsh-paths-document .dsh-paths-pre {
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  padding: 10px 12px;
  overflow: auto;
  margin: 12px 0;
}
.dsh-paths-document .dsh-paths-pre code { background: none; padding: 0; }
.dsh-paths-document .dsh-paths-table {
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 0.95em;
}
.dsh-paths-document .dsh-paths-table th, .dsh-paths-document .dsh-paths-table td {
  border: 1px solid var(--dsw-alias-border-l2);
  padding: 5px 9px;
  text-align: left;
}
.dsh-paths-document .dsh-paths-table th { background: var(--dsw-alias-bg-layer-2); }
.dsh-paths-document a.dsh-paths-external { color: inherit; }
/* 可点的路径：不用链接蓝（会和普通链接的"去浏览器"混淆），用点线 + hover 底色 */
.dsh-paths-target {
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
  border-radius: 4px;
}
.dsh-paths-target:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-paths-target:focus-visible {
  outline: 2px solid var(--dsw-alias-label-secondary);
  outline-offset: 1px;
}
.dsh-paths-plain { text-decoration: none; }
.dsh-paths-frame {
  background: var(--dsw-alias-bg-base);
  border: none;
  width: 100%;
  height: 100%;
  min-height: 240px;
  display: block;
}
.dsh-paths-status {
  color: var(--dsw-alias-label-secondary);
  white-space: normal;
  margin: 0;
  padding: 10px;
}
`;

/** 插一次样式（没有 DOM 的环境里什么都不做，方便单测） */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = '@yozica/dsh-plugin-paths';
  tag.dataset.pluginCss = STYLE_ID;
  tag.textContent = STYLES;
  document.head.appendChild(tag);
}
