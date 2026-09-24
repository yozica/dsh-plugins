#!/usr/bin/env node
// 本地首发脚本：pnpm pack（把 workspace:* 换成真实版本）+ 发布到 npmjs。
//
// 为什么不用 `npm publish` 直接跑：
//   1) npm pack 不会改写 workspace:*，必须走 pnpm pack（见 pack-all.mjs 的注释）；
//   2) 这个账号只有**安全密钥**（没有 6 位 TOTP），而 `--otp` 需要一个一次性口令。
//      注册表会给「写请求」返回 401 + {authUrl, doneUrl}，npm CLI 只在 TTY 里才会去开浏览器
//      （lib/utils/auth.js 里 otplease 的 TTY 判断）。本脚本复刻 npm 自己的做法：
//      把同一个 publish 请求重试一次，只是多带一个从 doneUrl 取到的一次性口令。
//
// 用法：
//   node scripts/publish-local.mjs [--userconfig ~/.npmrc-publish] [--registry URL] [--dry-run]
//   node scripts/publish-local.mjs --otp 1234567890123456      # 已经有口令时跳过浏览器
//
// 说明：脚本借用了本机 npm 的内部模块（pacote / libnpmpublish / npm-registry-fetch）。
// 为什么要借：要精确复刻 npm publish 的请求体（含 _attachments、access、dist-tags），
// 自己拼一个「和 npm 一样」的文档风险更大。这些都是 devDependency 之外的本机 npm，不影响发包内容。

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const DRY = args.includes('--dry-run');
const REGISTRY = flag(
  '--registry',
  process.env.NPM_PUBLISH_REGISTRY || 'https://registry.npmjs.org',
);
const USERCONFIG = path.resolve(
  (
    flag('--userconfig') ||
    (existsSync(path.join(homedir(), '.npmrc-publish')) ? '~/.npmrc-publish' : '~/.npmrc')
  ).replace(/^~/, homedir()),
);
const GIVEN_OTP = flag('--otp');

const root = path.resolve(import.meta.dirname, '..');
const packages = [
  { dir: 'packages/kit', name: '@yozica/dsh-plugin-kit' },
  { dir: 'packages/reveal', name: '@yozica/dsh-plugin-reveal' },
];

// ---- 本机 npm 的内部模块 -----------------------------------------------------
const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const require = createRequire(import.meta.url);
const load = (p) => require(path.join(npmRoot, 'npm/node_modules', p));
const pacote = load('pacote');
const libnpmpublish = load('libnpmpublish');
const npmFetch = load('npm-registry-fetch');

// ---- 凭据：只从 --userconfig 指定的文件读，绝不回显 -------------------------
const host = new URL(REGISTRY).host;
const token = (() => {
  const txt = readFileSync(USERCONFIG, 'utf8');
  const m = txt.match(
    new RegExp(`//${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/:_authToken=("?)([^"\\s]+)\\1`),
  );
  if (!m) throw new Error(`${USERCONFIG} 里没有 //${host}/:_authToken`);
  return m[2];
})();
const opts = {
  registry: REGISTRY,
  [`//${host}/:_authToken`]: token,
  access: 'public',
  defaultTag: 'latest',
  authType: 'web',
  npmCommand: 'publish',
  npmSession: Math.random().toString(36).slice(2),
  userAgent: `npm/publish-local node/${process.versions.node} ${process.platform} ${process.arch}`,
  cache: path.join(tmpdir(), 'dsh-plugin-publish-cache'),
  npmVersion: execFileSync('npm', ['-v'], { encoding: 'utf8' }).trim(),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function holdHint() {
  console.log('');
  console.log('  提示：如果这里是 404 {"error":"Not found"} 而**没有** 2FA 挑战，');
  console.log(
    '  极可能是账号正处于 72 小时只读「安全冻结」期（改邮箱 / 用 recovery code 登录触发）。',
  );
  console.log(
    '  自查：npmjs.com 顶部有没有红条 "temporarily suspended due to a recent security-sensitive action"。',
  );
  console.log(
    '  详见 docs/publishing.md 的「账号安全冻结」一节 —— 冻结期内重试没有意义，等自动解封。',
  );
}

async function getOtp(authUrl, doneUrl) {
  console.log(`  需要 2FA。请用安全密钥授权：\n    ${authUrl}`);
  try {
    execFileSync('open', [authUrl], { stdio: 'ignore' });
  } catch {
    /* 打不开浏览器就让人手动点上面的链接 */
  }
  for (let i = 0; i < 200; i++) {
    const res = await fetch(doneUrl, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 200) {
      const body = await res.json();
      if (!body.token) throw new Error('doneUrl 200 但没带 token');
      return body.token;
    }
    await sleep(3000);
  }
  throw new Error('等待授权超时（约 10 分钟）');
}

async function publishOne({ dir, name }) {
  console.log(`\n== ${name}`);
  const pkgDir = path.join(root, dir);
  const out = execFileSync('pnpm', ['pack'], { cwd: pkgDir, encoding: 'utf8' });
  const tarball = path.join(pkgDir, out.trim().split('\n').pop().trim());
  console.log(`  tarball: ${path.relative(root, tarball)}`);

  const manifest = await pacote.manifest(tarball, opts);
  const data = await pacote.tarball(tarball, opts);
  if (DRY) {
    // dry-run 就连网都不碰：只核对「包名/版本/access/依赖改写」是不是我们要发的东西
    console.log(
      `  dry-run: ${manifest.name}@${manifest.version} access=${opts.access} dependencies=${JSON.stringify(manifest.dependencies || {})}`,
    );
    return;
  }

  try {
    await libnpmpublish.publish(manifest, data, opts);
    console.log(`  ✓ ${name}@${manifest.version} 已发布`);
    return;
  } catch (err) {
    const { authUrl, doneUrl } = err.body || {};
    if (!authUrl || !doneUrl) {
      console.log(`  ✗ ${err.code}: ${err.message}`);
      if (err.body) console.log(`    body: ${JSON.stringify(err.body)}`);
      holdHint();
      process.exitCode = 1;
      return;
    }
    const otp = GIVEN_OTP || (await getOtp(authUrl, doneUrl));
    console.log(`  拿到一次性口令（长度 ${otp.length}），用同一个请求重试…`);
    await libnpmpublish.publish(manifest, data, { ...opts, otp });
    console.log(`  ✓ ${name}@${manifest.version} 已发布`);
  }
}

console.log(`registry = ${REGISTRY}`);
console.log(`凭据     = ${USERCONFIG}（token 长度 ${token.length}，不回显）`);
for (const p of packages) await publishOne(p);
console.log('\n核验：npm view <包名> version --registry=' + REGISTRY);
console.log(
  '发完记得：① 配两个包的 Trusted Publisher；② 撤销临时 token；③ 删掉 --userconfig 那个文件。',
);
