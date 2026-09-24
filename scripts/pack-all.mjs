/**
 * 把所有可发布的包打成 tarball 放进 `.release/`。
 *
 * 用途：给人装（`dsh plugin --profile web add <tgz>`）或存档。正式发布走 CI（见 .github/workflows/release.yml）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '.release');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const packagesDir = path.join(root, 'packages');
const names = fs
  .readdirSync(packagesDir)
  .filter((name) => fs.existsSync(path.join(packagesDir, name, 'package.json')));

for (const name of names) {
  const dir = path.join(packagesDir, name);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  console.log(`打包 ${manifest.name}@${manifest.version}`);
  // 用 **pnpm pack** 而不是 npm pack：只有 pnpm 会把依赖里的 `workspace:*` 换成真实版本号
  // （实测：npm pack 出来仍是 `workspace:*`，别人装上解析不了；CI 的 changeset publish 走 pnpm，没问题）。
  execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: dir, stdio: 'inherit' });
}
console.log(`\n产物在 ${path.relative(root, out)}/`);
