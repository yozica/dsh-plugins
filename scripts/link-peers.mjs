/**
 * 【兜底】把 DSH 的内部包链到**这台机器的 dsh 安装目录**里那一份。
 *
 * 正常情况**不需要它**：在仓库根跑一次 `pnpm install`，`@deepseek-ai/dsh-tools` / `cordis` 会装在
 * 根 node_modules 里，packages/ 下的包从自己的位置往上走就能解析到。只有当源上装不了这些内部包
 * （权限/网络）时，才用这个脚本绕过。
 *
 * 为什么需要它：本地插件是 `link:` 装的（真身在工作区，不在 profile 的 node_modules 里），
 * 而 ESM 是从**插件自己的位置**往上找 node_modules —— 于是 `@deepseek-ai/dsh-tools` 找不到，
 * dsh 会直接起不来（真机踩过：`Cannot find package '@deepseek-ai/dsh-tools'`）。
 * 官方随包的那些工具插件没这个问题，因为它们本来就住在 dsh 安装树里。
 *
 * 用法：`node scripts/link-peers.mjs [dsh 安装目录]`。**建议显式传**：机器上装了多个 Node 时会有多份
 * dsh，猜错版本会链到另一份 cordis / dsh-tools（同一进程里两份实例，行为说不清）。
 * 不给参数时按 nvm 版本号从高到低猜，并打印它选了谁。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PEERS = ['@deepseek-ai/dsh-tools', '@deepseek-ai/cordis'];

/** 猜几个 dsh 安装位置（nvm / 全局 node_modules） */
function candidates() {
  const home = os.homedir();
  const roots = [];
  if (process.argv[2]) roots.push(process.argv[2]);
  const nvm = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvm)) {
    for (const version of fs.readdirSync(nvm).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      roots.push(path.join(nvm, version, 'lib', 'node_modules', '@deepseek-ai', 'dsh'));
    }
  }
  roots.push(path.join(home, '.npm-global', 'lib', 'node_modules', '@deepseek-ai', 'dsh'));
  return roots;
}

const install = candidates().find((dir) => fs.existsSync(path.join(dir, 'package.json')));
if (!install) {
  console.error('找不到 dsh 安装目录，请显式传一个：node scripts/link-peers.mjs <dsh 目录>');
  process.exit(1);
}
const modules = path.join(install, 'node_modules');
const target = path.join(path.resolve(import.meta.dirname, '..'), 'node_modules', '@deepseek-ai');
fs.mkdirSync(target, { recursive: true });

let linked = 0;
for (const peer of PEERS) {
  const source = path.join(modules, peer);
  if (!fs.existsSync(source)) {
    console.warn(`跳过 ${peer}：安装目录里没有（${source}）`);
    continue;
  }
  const link = path.join(target, peer.split('/')[1]);
  if (fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false })) fs.rmSync(link, { force: true });
  fs.symlinkSync(source, link, 'dir');
  console.log(`链上 ${peer} → ${source}`);
  linked += 1;
}
console.log(linked > 0 ? `完成（${linked} 个 peer）。` : '什么都没链上。');
