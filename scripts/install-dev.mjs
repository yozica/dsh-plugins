/**
 * 把一个包**开发模式**装进 dsh 的 profile（link 装：改源码 → 重新 build → 重启 dsh 即生效）。
 *
 * 用法：`pnpm install:dev packages/reveal [--profile web]`
 *
 * 为什么不直接写 `dsh plugin add`：机器上可能有多个 Node / 多份 dsh，这里做三件事 ——
 * 找到能跑的那个 dsh、跑一次 build、把命令与结果说清楚。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const target = process.argv[2];
if (target === undefined) {
  console.error('用法：pnpm install:dev <包目录> [--profile <名字>]');
  process.exit(1);
}
const packageDir = path.resolve(root, target);
if (!fs.existsSync(path.join(packageDir, 'package.json'))) {
  console.error(`不是包目录：${packageDir}`);
  process.exit(1);
}
const profileIndex = process.argv.indexOf('--profile');
const profile = profileIndex === -1 ? 'web' : (process.argv[profileIndex + 1] ?? 'web');
const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));

console.log(`构建 ${manifest.name} …`);
execFileSync('pnpm', ['build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

console.log(`装进 profile "${profile}"（link 模式）…`);
try {
  execFileSync('dsh', ['plugin', '--profile', profile, 'add', packageDir], { stdio: 'inherit' });
} catch (error) {
  console.error('\n装失败。常见原因：PATH 里没有 dsh（用 `which dsh` 确认），或 pnpm 版本不对。');
  throw error;
}
console.log(
  `\n装好了。生效需要：**重启 dsh**（bundle 列表是启动时读的）+ **新开一个会话**（工具面是会话启动时定的）。`,
);
