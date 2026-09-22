/**
 * 把所有可发布的包打成 tarball 放进 `.release/`。
 *
 * 为什么不用 `pnpm -r publish`：现在还没定"发到哪个源、谁来发"。先把产物收在一个地方，
 * 谁要装就给那个 .tgz（`dsh plugin --profile web add <tgz>`），等发布权限确认了
 * 再把 `pnpm -r publish` 接上——两条路都用同一份清单，不重复。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '.release');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const packagesDir = path.join(root, 'packages');
const names = fs.readdirSync(packagesDir).filter((name) =>
  fs.existsSync(path.join(packagesDir, name, 'package.json')),
);

for (const name of names) {
  const dir = path.join(packagesDir, name);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  console.log(`打包 ${manifest.name}@${manifest.version}`);
  // 缓存与日志目录放在仓内：npm 默认写 ~/.npm，受限环境（沙箱 / CI）里会直接失败。
  execFileSync(
    'npm',
    ['pack', '--pack-destination', out, '--cache', path.join(out, '.npm-cache'), '--logs-dir', path.join(out, '.npm-logs')],
    { cwd: dir, stdio: 'inherit' },
  );
}
console.log(`\n产物在 ${path.relative(root, out)}/`);
