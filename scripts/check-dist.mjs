/**
 * 产物形状检查：构建出来的东西，宿主认不认。
 *
 * 单测跑的是 `src/`，这一步跑的是 `lib/` —— 两件事都可能出错，且错法不同：
 *   - 服务端：`lib/index.js` 要导出 `name` / `inject` / `apply`；
 *   - 浏览器：`lib/client.js` 要**在求值时调用** `window.__ModuleLoader__.load({ id, factory })`，
 *     且 `factory(require)` 返回的对象上要有 `name` / `inject` / `apply`。
 *
 * 用法：`node scripts/check-dist.mjs`（在 `pnpm build` 之后跑）
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const packagesDir = path.join(root, 'packages');
const problems = [];
let checked = 0;

for (const name of fs.readdirSync(packagesDir).sort()) {
  const dir = path.join(packagesDir, name);
  const manifestPath = path.join(dir, 'package.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const isPlugin = manifest.dsh !== undefined;

  // 服务端半边
  const serverEntry = path.join(dir, 'lib', 'index.js');
  if (fs.existsSync(serverEntry)) {
    const module = await import(`${serverEntry}?t=${Date.now()}`);
    if (isPlugin) {
      for (const field of ['name', 'apply']) {
        if (typeof module[field] !== 'function' && typeof module[field] !== 'string') {
          problems.push(`${manifest.name}: lib/index.js 没有导出 ${field}`);
        }
      }
      if (!Array.isArray(module.inject))
        problems.push(`${manifest.name}: lib/index.js 的 inject 不是数组`);
    }
    checked += 1;
    console.log(
      `✔ 服务端 ${manifest.name} → name=${module.name} inject=[${(module.inject ?? []).join(', ')}]`,
    );
  } else if (isPlugin) {
    problems.push(`${manifest.name}: 没有 lib/index.js（先跑 pnpm build）`);
  }

  // 浏览器半边
  if (manifest.dsh?.client !== undefined) {
    const clientFile = path.join(dir, 'lib', 'client.js');
    if (!fs.existsSync(clientFile)) {
      problems.push(`${manifest.name}: 声明了 dsh.client，但没有 lib/client.js（先跑 pnpm build）`);
      continue;
    }
    const code = fs.readFileSync(clientFile, 'utf8');
    let loaded;
    const sandbox = {
      window: { __ModuleLoader__: { load: (def) => (loaded = def) } },
      EventSource: function EventSource() {},
      console,
    };
    try {
      vm.runInNewContext(code, sandbox, { filename: clientFile });
    } catch (error) {
      problems.push(`${manifest.name}: lib/client.js 求值就抛错 —— ${error.message}`);
      continue;
    }
    if (loaded === undefined) {
      problems.push(`${manifest.name}: lib/client.js 没有调用 window.__ModuleLoader__.load(...)`);
      continue;
    }
    if (loaded.id !== manifest.name) {
      problems.push(
        `${manifest.name}: loader 里的 id 是 ${JSON.stringify(loaded.id)}，应与包名一致`,
      );
    }
    const required = [];
    const exports = loaded.factory((specifier) => {
      required.push(specifier);
      return {};
    });
    for (const field of ['name', 'inject', 'apply']) {
      if (exports[field] === undefined)
        problems.push(`${manifest.name}: 浏览器半边没有导出 ${field}`);
    }
    // 客户端产物允许向宿主要哪些包 —— 按**宿主真实机制**判，不按我们自己发明的字段：
    //
    //   - 壳的静态模块表（PLATFORM_MODULES，`dsh-web-frontend` 引导时 seed 进模块系统）；
    //     在表里的名字可以直接 require，宿主一定提供。
    //   - 其他精确模块请求必须写进 `dsh.client.external`（`WebBootEntry.external`），
    //     组合期由宿主校验；没写的会在运行期解析失败。
    //
    // 名字来自本机 0.1.5-rc.x 壳产物里的 staticModules 表；上游加表项时同步这里即可。
    const PLATFORM_MODULES = new Set([
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-store',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-dockkit',
    ]);
    const declaredExternal = manifest.dsh?.client?.external ?? [];
    const undeclared = required.filter(
      (specifier) => !PLATFORM_MODULES.has(specifier) && !declaredExternal.includes(specifier),
    );
    if (undeclared.length > 0) {
      problems.push(
        `${manifest.name}: 客户端产物 require 了宿主没承诺提供的包：${undeclared.join(', ')}` +
          `（要么打进产物，要么它是静态模块；否则写进 dsh.client.external 并确认宿主会提供）`,
      );
    }
    checked += 1;
    console.log(
      `✔ 浏览器 ${manifest.name} → inject=[${(exports.inject ?? []).join(', ')}]` +
        (required.length > 0
          ? `（host require: ${required.join(', ')}${undeclared.length === 0 ? ' ✓' : ' ✗'}）`
          : '（无 host require）'),
    );
  }
}

console.log(`\n检查了 ${checked} 份产物，问题 ${problems.length} 个`);
for (const problem of problems) console.error(`  ✗ ${problem}`);
process.exit(problems.length === 0 ? 0 : 1);
