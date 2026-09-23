/**
 * `@yozica/dsh-plugin-kit/build` —— **构建期**用的帮助（在 Node 里跑，不进浏览器）。
 *
 * 官方插件的客户端产物都是"打包 + 一层 loader 包装"；这里提供那层包装的生成函数，
 * 由仓库的 `scripts/build-client.mjs` 在 esbuild 之后调用。
 *
 * @module @yozica/dsh-plugin-kit/build
 */

/**
 * 把一段 **CommonJS** 代码包成 DSH 客户端模块。
 *
 * 宿主用 `window.__ModuleLoader__` 装载客户端模块，factory 会拿到一个 `require` ——
 * 宿主包（`@deepseek-ai/dsh-client-*`）就用它拿，构建时标 external 即可。
 *
 * @param id 包名（loader 里的模块 id）
 * @param code esbuild 产出的 CJS 代码
 */
export function wrapClient(id: string, code: string): string {
  return `// 由 @yozica/dsh-plugin-kit/build 生成 —— 不要手改这个文件，改 src/client/。
window.__ModuleLoader__.load({
  id: ${JSON.stringify(id)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${code
  .split('\n')
  .map((line) => (line === '' ? '' : `    ${line}`))
  .join('\n')}
    return module.exports;
  },
});
`;
}
