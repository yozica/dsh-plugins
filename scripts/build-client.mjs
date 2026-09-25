/**
 * 把一个包的浏览器半边打成宿主认得的产物：`lib/client.js`。
 *
 * 输入：`<包>/src/browser.ts`（没有就跳过 —— 纯服务端插件是合法的）
 * 过程：esbuild 打成 CJS（宿主包标 external，其它依赖打进去）→ 套一层
 *       `window.__ModuleLoader__.load({ id, factory })`（包装函数来自 kit）
 * 输出：`<包>/lib/client.js`
 *
 * 用法：`node scripts/build-client.mjs <包目录>`
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const packageDir = path.resolve(process.argv[2] ?? '.');
const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const entry = path.join(packageDir, 'src', 'browser.ts');
if (!fs.existsSync(entry)) {
  console.log(`${manifest.name}: 没有 src/browser.ts，跳过浏览器半边`);
  process.exit(0);
}

// esbuild 在仓根（各包不重复声明）；kit 用**已构建的产物**（build 顺序保证它先构建）
const requireFromPackage = createRequire(path.join(packageDir, 'package.json'));
const { build } = createRequire(path.join(process.cwd(), 'package.json'))('esbuild');
let wrapClient;
try {
  ({ wrapClient } = requireFromPackage('@yozica/dsh-plugin-kit/build'));
} catch (error) {
  // workspace 链接还没建（比如刚加依赖还没 install）时给一句能照做的错
  console.error(
    `找不到 @yozica/dsh-plugin-kit/build：先在仓库根跑 \`pnpm install\` 与 \`pnpm build\`。`,
  );
  throw error;
}

const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'none',
  logLevel: 'warning',
  // 宿主提供的客户端包由 loader 的 require 提供，不打进来。`react` 一族同样是宿主提供
  // （社区 UI 插件就是这么拿的：dshmarket/client/client.js 里 require("react")／("react-dom")／
  //  ("@deepseek-ai/dsh-client-ui-primitives")）；只有真要画组件的包才会 require 到它们。
  external: [
    '@deepseek-ai/*',
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
  ],
});
const code = result.outputFiles[0].text;
const outFile = path.join(packageDir, 'lib', 'client.js');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, wrapClient(manifest.name, code));
console.log(
  `${manifest.name}: 浏览器半边 → ${path.relative(process.cwd(), outFile)}（${code.length} 字节）`,
);
