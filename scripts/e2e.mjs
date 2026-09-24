/**
 * 端到端验证：**真起一个 dsh + 真开一个浏览器**，断言插件的两半都活着、帧能到、面板真的打开。
 *
 * 为什么必须有这么一层：单测跑的是 `src/`、check:dist 跑的是产物形状 —— 但"浏览器那半有没有连上频道"、
 * "面板到底开没开"只有真环境能回答。这一层把此前手工做的步骤固化下来。
 *
 * 用法：`pnpm e2e [--port 3399] [--keep]`
 *   --port   给这次验证的 dsh 用的端口（默认 3399，避开日常在用的）
 *   --keep   跑完不杀进程（留着看现场；默认会清掉）
 *
 * 前置：本机有 Chrome / Edge（headless 即可）、PATH 里有 dsh（或用 nvm 里那份）。
 * 产物：`.verify/e2e/`（dsh 日志、截图、样例文件）——该目录被 git 忽略。
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, '.verify', 'e2e');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const port = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : 3399);
const keep = args.includes('--keep');
const cdpPort = port + 1;
const marker = `E2E-${Date.now().toString(36)}`;
const sample = path.join(outDir, 'sample.html');
fs.writeFileSync(
  sample,
  `<!doctype html><meta charset="utf-8"><title>${marker}</title><h1>${marker}</h1>`,
);

/** 出了任何岔子都要把这次起的进程收掉，别留一个占着端口的 dsh（踩过：上一次崩在清理前，
 *  下一次跑就说"dsh 起得来"失败，而真正的原因是端口被上一轮的残留占着）。 */
const spawned = { dsh: null, browser: null };
function cleanup() {
  for (const child of [spawned.browser, spawned.dsh]) {
    try {
      child?.kill('SIGTERM');
    } catch {}
  }
  spawned.browser = null;
  spawned.dsh = null;
}
function fail(what, detail = '') {
  bad(what, detail);
  cleanup();
  process.exit(1);
}
process.on('uncaughtException', (error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});

const results = [];
const ok = (what, detail = '') => (
  results.push(['✔', what, detail]),
  console.log(`✔ ${what}${detail ? ` — ${detail}` : ''}`)
);
const bad = (what, detail = '') => (
  results.push(['✘', what, detail]),
  console.error(`✘ ${what}${detail ? ` — ${detail}` : ''}`)
);

/** 找 dsh：PATH 优先，其次 nvm 里那份（GUI/受限环境 PATH 往往不全） */
function resolveDsh() {
  try {
    const bin = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim();
    if (bin) return { file: bin, args: [] };
  } catch {}
  const nvm = path.join(os.homedir(), '.nvm', 'versions', 'node');
  if (fs.existsSync(nvm)) {
    for (const v of fs
      .readdirSync(nvm)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      const bin = path.join(nvm, v, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
      if (fs.existsSync(bin)) return { file: process.execPath, args: [bin] };
    }
  }
  return null;
}

function resolveBrowser() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => (await fetch(url)).text();

/** 极简 CDP 客户端（Node 自带 WebSocket）：给页面求值 / 截图 */
async function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, (m) =>
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result),
      );
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 失败');
    return result.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

const dsh = resolveDsh();
if (dsh === null) fail('找到 dsh', 'PATH 里没有，nvm 里也没扫到 —— 请把 dsh 装上或加进 PATH');
const browser = resolveBrowser();
if (browser === null) fail('找到浏览器', '需要 Chrome / Chromium / Edge / Brave 之一');

// ① 把插件装进 profile（幂等：已在就什么都不改）
const profileDir = path.join(
  process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'),
  'profiles',
  'web',
);
const profileManifest = path.join(profileDir, 'package.json');

// 清掉历史遗留的旧包名：它和新包名会各插入一行、id 还是同一个 → dsh 报
// `duplicate loader entry id: reveal` 直接起不来（真机踩过）。这里自动兜住，别让人手工查。
if (fs.existsSync(profileManifest)) {
  const deps = JSON.parse(fs.readFileSync(profileManifest, 'utf8')).dependencies ?? {};
  if ('dsh-plugin-reveal' in deps) {
    try {
      execFileSync(
        dsh.file,
        [...dsh.args, 'plugin', '--profile', 'web', 'remove', 'dsh-plugin-reveal'],
        {
          stdio: 'pipe',
        },
      );
      ok('清掉历史遗留包名', 'dsh-plugin-reveal（它的 insert id 与新包名重复）');
    } catch (error) {
      bad('清掉历史遗留包名', String(error.message));
    }
  }
}
try {
  execFileSync(
    dsh.file,
    [...dsh.args, 'plugin', '--profile', 'web', 'add', path.join(root, 'packages', 'reveal')],
    {
      stdio: 'pipe',
    },
  );
  ok('插件已装进 profile', 'dsh plugin --profile web add packages/reveal');
} catch (error) {
  fail('装插件', String(error.stdout ?? '') + String(error.message));
}

// ② 起 dsh（独立端口，日志留档）
const dshLog = fs.openSync(path.join(outDir, 'dsh.log'), 'a');
const dshProc = spawn(dsh.file, [...dsh.args, 'web', '--no-open', '--port', String(port)], {
  // cwd = 仓库根：会话的工作区就是它，样例文件（.verify/e2e/）因此落在工作区**内** ——
  // 工作区外的绝对路径虽然也是合法地址，但文件提供方可能不给读，验证时要走常见路径。
  cwd: root,
  stdio: ['ignore', dshLog, dshLog],
});
spawned.dsh = dshProc;
let dshUrl = null;
for (let i = 0; i < 60 && dshUrl === null; i += 1) {
  await wait(1000);
  const log = fs.readFileSync(path.join(outDir, 'dsh.log'), 'utf8');
  dshUrl = /http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/.exec(log)?.[0] ?? null;
}
if (dshUrl === null) {
  fail('dsh 起得来', '60 秒内没在日志里看到带 token 的地址（见 .verify/e2e/dsh.log）');
}
ok('dsh 起得来', dshUrl.replace(/token=\S+/, 'token=***'));

// ③ 起 headless 浏览器打开界面
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-e2e-'));
const browserProc = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    dshUrl,
  ],
  { stdio: 'ignore' },
);
spawned.browser = browserProc;
let target = null;
for (let i = 0; i < 40 && target === null; i += 1) {
  await wait(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    target = list.find((t) => t.type === 'page' && t.url.includes(`127.0.0.1:${port}`)) ?? null;
  } catch {}
}
if (target === null) fail('浏览器打开了界面', `CDP ${cdpPort} 上没找到目标页面`);
ok('浏览器打开了界面', target.url.replace(/token=\S+/, 'token=***'));
const cdp = await connectCdp(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');

// ④ 断言一：客户端半边登记进了模块图（不需要浏览器也能查）
// 在**页面里**读这个 SSE：同源 + 带 cookie（从 Node 直连读不到东西）
const graph = await cdp
  .evaluate(
    `(async () => {
    const controller = new AbortController();
    let text = '';
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch('/plugins/events', { signal: controller.signal });
      if (!response.ok) return 'STATUS ' + response.status;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (text.length < 400000) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    } catch {
      // 到点 abort：**已经读到的部分照用**（graph 帧在连上的一瞬间就到了）
    } finally { clearTimeout(timer); controller.abort(); }
    return text.length > 0 ? text : 'EMPTY';
  })()`,
  )
  .catch((error) => `ERROR ${error.message}`);
graph.includes('@yozica/dsh-plugin-reveal')
  ? ok('客户端半边登记进模块图', `页面里读到 graph 帧 ${String(graph).length} 字节，含包名`)
  : bad('客户端半边登记进模块图', `读到：${String(graph).slice(0, 120)}`);

// ⑤ 断言二：拿会话 id（界面自己会在 localStorage 里记当前会话）
let sessionId = null;
for (let i = 0; i < 40 && sessionId === null; i += 1) {
  await wait(500);
  const raw = await cdp.evaluate(`localStorage.getItem('dsh.sessions.current')`).catch(() => null);
  try {
    sessionId = JSON.parse(raw)?.sessionId ?? null;
  } catch {}
}
if (sessionId === null) {
  bad('拿到当前会话 id', 'localStorage 里没有 dsh.sessions.current（界面还没建会话？）');
} else {
  ok('拿到当前会话 id', sessionId);
}

// ⑥ 断言三：推一帧（走插件的维护口）→ 浏览器那半收到（clients ≥ 1）
if (sessionId !== null) {
  const push = await get(
    `http://127.0.0.1:${port}/plugin-reveal/push?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(sample)}`,
  ).catch((error) => `{"error":"${error.message}"}`);
  let parsed = null;
  try {
    parsed = JSON.parse(push);
  } catch {}
  if (parsed?.clients >= 1)
    ok('帧推到了浏览器', `clients=${parsed.clients}，地址 ${parsed.frame.address}`);
  else bad('帧推到了浏览器', push.slice(0, 200));

  // ⑦ 断言四：右侧栏真的打开了这个文件（以 DOM 文本 + 截图为准）
  let panel = { open: false, text: '' };
  for (let i = 0; i < 20; i += 1) {
    await wait(500);
    panel = await cdp
      .evaluate(
        `(() => { const right = document.querySelector('[data-side=right]');
           const box = right?.getBoundingClientRect();
           return { open: Boolean(right) && box.width > 0,
                    text: (right?.innerText ?? '') + ' || body: ' + document.body.innerText.slice(-240) }; })()`,
      )
      .catch(() => ({ open: false, text: '' }));
    if (panel.text.includes(marker) || panel.text.includes('sample.html')) break;
  }
  panel.text.includes(marker)
    ? ok('右侧栏打开了该文件', '面板里看到样例标记')
    : panel.text.includes('sample.html')
      ? ok('右侧栏打开了该文件', '面板里看到文件名')
      : bad(
          '右侧栏打开了该文件',
          `面板 open=${panel.open}；正文：${panel.text.replace(/\s+/g, ' ').slice(0, 200)}`,
        );
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (shot?.data) {
    fs.writeFileSync(path.join(outDir, 'panel.png'), Buffer.from(shot.data, 'base64'));
    ok('留档截图', '.verify/e2e/panel.png');
  }
}

// ⑧ 收尾
cdp.close();
if (!keep) {
  cleanup();
  ok('清掉这次起的进程', '（加 --keep 可以留着看现场）');
} else {
  console.log(`--keep：dsh 还在 ${dshUrl.replace(/token=\S+/, 'token=***')}`);
}

const failed = results.filter(([mark]) => mark === '✘').length;
console.log(`\n${results.length - failed}/${results.length} 项通过`);
process.exit(failed === 0 ? 0 : 1);
