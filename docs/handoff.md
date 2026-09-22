# dsh-plugins 交接文档

> **读者**：另一个环境里的 DSH agent（以及背后的开发同学）。
> **用途**：这份文档自带全部背景 —— 你不需要看到此前的对话，就能接着把 `dsh-plugins` 这个项目搭起来。
> **一句话**：我们要做一个**自研 DSH 插件的多包仓**，框架已经设计并裁定（§2），技术事实已经在真机核对过（§3、§4），
> 你按 §5 的步骤实现、按 §6 的方式验证即可。**与裁定冲突的想法先别改，写成提案（§9）再讨论。**

---

## 1. 目标与范围

**定位**：自研 DSH（DeepSeek Harness）插件的唯一产地 —— 一仓多包、一份契约、一套验证、一条发布路径。

**当前已验证的能力边界**（✅ 真机跑通 / 🟡 见过 API 未验证 / ⬜ 未碰）：

| 能加什么 | 靠什么 | 状态 |
| --- | --- | --- |
| agent 工具（模型能调的动作） | `ctx.tools.register(definition)` | ✅ |
| 浏览器界面（右栏面板/标签、页面、槽位、命令） | 客户端插件 + `ctx.slots` / `ctx.sidebarRight` / `ctx.layout` | ✅ 打开文件；🟡 自定义面板 |
| 服务端服务与 HTTP 路由（含 SSE 推送） | `ctx.webServer.register` + `ctx.effect` | ✅ |
| 会话数据（投影 / 事件） | `ctx.sessionProjections` | 🟡 只见过读侧 |
| agent 行为（preset / system prompt / hooks） | `dsh-agent-*` / `dsh-hooks-*` | ⬜ 风险最高，暂不设计 |

**本期只做前两行**（工具 + 界面），其余留作以后。

**明确不做**（避免过度设计）：插件市场/商店；多版本 DSH 并存的兼容层；自建 registry；提前抽 UI 组件库、提前 i18n；
提前为 Windows 做特例。

---

## 2. 已裁定的框架决定（**不要重新讨论**，要改先提提案）

| # | 决定 | 关键理由 |
| --- | --- | --- |
| A | 包名 **`@yozica/dsh-plugin-*`**，只发**官方源**（npmjs.com） | 名字归自己；`publishConfig.access = "public"` 必须在（scoped 默认 restricted） |
| B | `packages/kit` **薄**：只收"依赖 DSH 内部实现"的东西（自造 tool 定义构造器、地址语法、SSE 频道、客户端包装、DSH 版本断言、自己的最小类型）。**UI/设置/日志等第二个插件真用到再上移** | 所有插件挂在 kit 上，它的表面要小、语义要稳 |
| C | **零 `@deepseek-ai` 依赖**：插件源码不 import 任何 DSH 包 | 这是"能发公共源、谁的 DSH 都能装"的前提；也顺带消灭"`link:` 装法解析不到内部包 → dsh 起不来"的坑 |
| D | 源码 **TypeScript**；服务端 `tsc` → `lib/`，客户端 **esbuild** → `lib/client.js` + loader 包装；宿主包标 external | 手写 loader 包装迟早要返工，一次做对 |
| E | 验证分三层：纯逻辑单测（`node --test`）／契约测试（假 ctx）／**`pnpm e2e`**（起 dsh → CDP 连浏览器 → 断言） | 端到端不能再靠手工（此前是手工做的） |
| F | 版本用 **changesets**；CI 只跑 test/typecheck/lint/build，**不自动发布** | 沿用既有习惯；发布要人点头 |
| G | 重建方式：**本地搭好并跑通 → 在 GitHub 上删除旧仓 → 同名重建 → 一次推上去** | 旧对象随删库清掉，名字与 URL 不变 |

---

## 3. 已核实的 DSH 插件契约（**0.1.5-rc.2**，真机核对，非文档抄录）

> ⚠️ 你在别的环境里，**先花 5 分钟按 §6.0 在本机复核这些路径与形状**（版本可能不同），再动手。

### 3.1 一个插件的形状

```
<包>/
  package.json
    main                服务端半边（cordis 插件）
    exports["./client"] 浏览器半边
    dsh.bundle.patch    自带一层 cordis.patch.yml → 会被写进 profile 的 dsh.profile.bundles
    dsh.client          { platform: 'web', inject: [宿主客户端包的包名…] }
  cordis.patch.yml      - insert: [ { id: <行id>, name: <包名> } ]   ← 把自己挂进 loader
  lib/index.js          服务端
  lib/client.js         浏览器
```

**只写一半也合法**：纯客户端插件不写 `main` 的副作用；纯服务端插件不写 `dsh.client`。

### 3.2 服务端半边

```js
export const name = 'plugin-xxx';
export const inject = ['tools', 'webServer', 'fs'];   // 需要的宿主服务
export function apply(ctx) { /* 注册工具 / 路由 … */ }
```

- **注册 agent 工具**：`ctx.tools.register(definition)`。`definition` 只要求：
  `name`、`output { schema, render, presentationMeta? }`、`timeoutMs?`、`execute(args, exec)`；
  `parameters` 与 `output.schema` 都是**标准 JSON Schema**。
  → 所以 kit 可以自己造这份定义，**不必** import `@deepseek-ai/dsh-tools` 的 `defineTool`
  （它只是把紧凑写法转成 JSON Schema + 在执行前校验参数；kit 自己实现这两件事）。
- **HTTP 路由**：`ctx.webServer.register({ kind: 'exact', path, handler })`；
  服务端 → 浏览器推数据最省事的是 **SSE**（官方 `dsh-client-hmr` 的 `/plugins/events` 就是范例：
  `res.writeHead(200, {'content-type':'text/event-stream', …})` + `data: ${JSON.stringify(frame)}\n\n`）。
- **清理**：一律 `ctx.effect(() => () => { …dispose })`。
- **工具里拿会话**：`exec.agent.session` → `session.header.id` / `session.header.cwd`；
  查文件：`ctx.fs.lstat(path, { cwd }, exec.signal)`（返回项有 `.type`，常规文件是 `'file'`）。

### 3.3 浏览器半边

```js
window.__ModuleLoader__.load({
  id: '<包名>',
  factory: (require) => {                     // 宿主包用 require(...) 拿（构建期标 external）
    var module = { exports: {} };
    var exports = module.exports;
    exports.name = 'plugin-xxx';
    exports.inject = ['sidebarRight'];        // ← 服务名（不是包名）
    exports.apply = function apply(ctx) { /* ctx.sidebarRight / ctx.effect … */ };
    return module.exports;
  },
});
```

- 客户端能用的跨插件面（已核实）：**`ctx.sidebarRight`**（注释里写明 *Cross-plugin right-Sidebar face*）：
  `openResource(address, options?)` / `openTab(kind, options?)` / `focus`。
  官方对话页打开文件走的就是 `ctx.sidebarRight.openResource(address)`。
- `dsh.client.inject` 里写的是**宿主包的包名**（如 `@deepseek-ai/dsh-client-ui-sidebar-right`），
  只声明加载顺序，**不要**把它装成依赖。
- `dsh-util-workspace-path` 这类包**没有客户端面**，浏览器里 require 不到 → 要用它的纯函数就**在 kit 里实现一份**。

### 3.4 资源地址语法

```
dsh-resource://file/session/<sessionId>/<path>
```

- 工作区**内**的绝对路径削成相对；工作区**外**的**保留前导 `/`**（地址里出现两个斜杠）——
  这是对的：解析回来才是 `/tmp/x.png` 这个绝对路径，少了它就变成相对工作区的另一个文件。
- 地址构造规则（kit 里实现并单测）：
  - 相对路径 → 直接编码；
  - 绝对且在工作区内（`cwd` 前缀）→ 去掉 `cwd/` 再编码；
  - 绝对且在**工作区外** → 原样编码（保留前导斜杠）；
  - 每段 `encodeURIComponent`，但把 `%3A` 还原成 `:`（Windows 盘符）。

### 3.5 装上之后怎么生效（**必须记住的三条**）

1. `dsh plugin --profile web add <目录|tgz|git|包名>` 会改 profile 的 `package.json` 与
   `dsh.profile.bundles`（声明了 `dsh.bundle` 时）；`remove` / `update` 同理。
2. **bundle 列表与服务端行是启动时装的 → 要重启 dsh**。
3. **客户端模块与 agent 工具面是会话启动时定的 → 已在跑的会话不会凭空多出你的工具，要新开会话**。

---

## 4. 已经踩过的坑（**照着避，别重复付学费**）

| 症状（原始报错） | 原因 | 正确做法 |
| --- | --- | --- |
| `dsh: plugin tree failed to load: … Cannot find package '@deepseek-ai/dsh-tools' imported from …/lib/index.js` —— **dsh 完全起不来** | 插件用 `link:` 装（真身在仓里），ESM 从插件位置往上找不到内部包 | 决定 C：插件**不 import** 任何 `@deepseek-ai/*`；万不得已才用"把内部包链到 dsh 安装目录"的兜底脚本 |
| 插件装上了，但界面没反应 | 只写了服务端半边 / 客户端 inject 写成了包名以外的错值 | 两半都要有；`dsh.client.inject` 写**包名**，代码里 `inject` 写**服务名** |
| 新工具"装了但模型看不到" | 工具面在会话启动时确定 | **新开一个会话**再试 |
| 面板打开了但内容空白 / 报错 | 地址语法错了（尤其"工作区外绝对路径要保留前导 `/`"这条） | 用 kit 的地址构造函数 + 单测（见 3.4） |
| 卸载/升级后行为不对 | 改的是 profile 的 `bundles`，dsh 没重启 | 重启 dsh |
| 打包脚本在受限环境报错 `Log files were not written … ~/.npm/_logs` | `npm pack` 默认写 HOME | 给 `npm pack` 显式传 `--cache/--logs-dir` 到仓内目录 |

---

## 5. 目标结构与实现步骤

### 5.1 目标结构

```
dsh-plugins/
  package.json            private 根：workspace + 脚本（build / test / e2e / pack:all / install:dev）
  pnpm-workspace.yaml      packages/*
  tsconfig.base.json
  .github/workflows/ci.yml pnpm -r test + typecheck + lint + build（不发布）
  .changeset/
  docs/architecture.md     框架与裁定的单一事实来源（已有）
  docs/plugin-contract.md  DSH 插件契约（已有，实现时对照）
  docs/decisions/          每条拍板一条记录
  packages/kit/            ★ 内部实现的唯一封装点（决定 B/C）
  packages/reveal/         第一个插件（现有实现迁入，作为参考实现）
  templates/plugin/        新插件骨架（cp -R 即用）
  scripts/{build-clients,e2e,install-dev,pack-all,link-peers}.mjs
```

### 5.2 步骤与验收

| 步 | 做什么 | 验收（**必须真跑**） |
| --- | --- | --- |
| **1** | 根清单 + workspace + TS 配置 + `packages/kit` 骨架 + `templates/plugin` + 构建脚本 | `pnpm install`、`pnpm build`、`pnpm -r test` 三条命令通过 |
| **2** | 把 `reveal` 迁进 `packages/reveal`：改用 TS + kit（工具定义、SSE 频道、客户端包装、地址语法都从 kit 取） | 单测绿；**契约测试**（假 ctx 断言"注册了名为 reveal 的工具、挂了 `/plugin-reveal/events` 路由"）绿；`lib/` 产物形状对（`main` 与服务端 `exports["./client"]` 都能加载） |
| **3** | `pnpm e2e`：起 dsh → CDP 连浏览器 → 断言 | 一条命令给出结论（见 §6.2 配方） |
| **4** | CI + changesets + 文档定稿（architecture / plugin-contract / decisions / 每个插件的 README） | 本地等价命令全绿；`npx changeset status` 有片段 |
| **5** | GitHub：删除旧仓 → 同名重建 → 推 | 远端旧 SHA 查不到；URL 与名字不变；CI 绿 |

### 5.3 kit 的最小表面（建议签名，可调整）

```ts
// 服务端
export function defineTool(def: { name, description, parameters, output, execute, timeoutMs? }): ToolDefinition;
export function sessionFileAddress(sessionId: string, path: string): string;
export function fileAddressFor(sessionId: string, cwd: string | undefined, path: string): string;
export function assertDshVersion(ctx: unknown, expected: string): void;   // 不匹配只告警、不崩
export function sseChannel(ctx): { register(path): void; broadcast(frame): number };

// 客户端（构建期使用）
export function wrapClient(id: string, body: string): string;             // 生成 __ModuleLoader__ 包装
export function subscribeReveal(ctx, path: string, handler: (frame) => void): void;
```

---

## 6. 验证配方（**照抄即可**）

### 6.0 先在本机复核契约（5 分钟）

```bash
DSH=$(npm root -g)/@deepseek-ai/dsh          # 或 nvm 下的实际路径
grep -n "register(definition)" "$DSH/node_modules/@deepseek-ai/dsh-tools/lib/index.js"   # 工具定义的四项要求
grep -n "Cross-plugin right-Sidebar face" -r "$DSH/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js"
grep -n "dsh-resource://file/" -r "$DSH/node_modules/@deepseek-ai/dsh-util-workspace-path/lib/index.js"
```
三条都在 → 契约与本文一致，可以开工；任何一条找不到 → **先报告**，别硬写。

### 6.1 静态与单测

```bash
pnpm install && pnpm -r test        # 纯逻辑单测
pnpm build                          # 服务端 tsc + 客户端 esbuild
node -e "import('./packages/reveal/lib/index.js').then(m => console.log(Object.keys(m)))"   # 产物能加载
```

### 6.2 端到端（把"手工步骤"固化成脚本）

1. 起一个**独立**的 dsh（不要动用户正在用的那个实例）：
   `DSH_HOME=<临时目录>? ` —— 注意 profile 在 `~/.dsh/profiles/web`，改 `DSH_HOME` 要整套复制 profile，成本高；
   此前做法是用一个独立端口的 dsh（`dsh web --no-open --port <未占用端口>`）并在其日志里读 token URL。
2. 用 Electron/Chromium 打开那个带 token 的地址，并开 **CDP**（`--remote-debugging-port`）。
3. 从 CDP 里取 **webview/page 类型**的 target，然后：
   - 断言客户端半边已加载：`curl -N http://127.0.0.1:<port>/plugins/events | grep <包名>`
     （graph 帧里应有 `{"id":"<包名>","url":"/plugins/??<包名>/client.js…"}`）；
   - 取当前会话 id：页面里 `JSON.parse(localStorage.getItem('dsh.sessions.current')).sessionId`；
   - 触发场景：调工具（新会话里让模型调一次）或**给插件配一个只允许本机访问的测试口**
     （此前做法：`GET /plugin-reveal/push?sessionId=…&path=…`，非 loopback 直接 403）；
   - 断言界面真的响应（例：`document.querySelector('[data-side=right]').innerText` 里出现文件名）+ 截图。
4. 断言的"金标准"是**截图 + DOM 文本**，不是"看起来在跑"。

### 6.3 形状检查（装上之后）

```bash
dsh web --dump-config | grep -A2 'name: <包名>'      # loader 认了这行
python3 -c "import json;print(json.load(open('$HOME/.dsh/profiles/web/package.json'))['dsh']['profile']['bundles'])"
```

---

## 7. 仓库、身份与发布

- **仓库**：`github.com/yozica/dsh-plugins`，**private**，默认分支 `main`。
  目前是旧结构 + 一个"内容干净但历史里有旧对象"的状态 —— 按决定 G **删掉重建**。
- **git 身份**：这台机器的**全局**身份是另一个（工作用）身份，**不要用它提交**；
  开工前先在仓内钉住本项目该用的身份：

  ```bash
  git config --local user.name  <GitHub 用户名>
  git config --local user.email <GitHub 的 noreply 邮箱>
  ```

  **提交里不要出现公司信息**：不写内部服务域名/名称、不写凭据、不写本机绝对路径与用户名
  （模板、脚本、文档、测试夹具都算）。
- **发布（官方源）**：
  - `npm whoami` 确认身份；scope 必须归你（同名用户名，或你建的 org）；
  - 各包 `publishConfig: { access: "public" }`（scoped 默认是 private）；
  - `npm publish --otp=<码>`（若开了 2FA）；
  - **不需要**内网源或内网包（决定 C）。
- **CI**：`pnpm -r test` + `tsc` + `eslint`/`prettier` + `build`；**不自动发布**。

---

## 8. 现状清单（交接时的真实状态）

| 东西 | 位置 / 状态 |
| --- | --- |
| 现有插件实现（参考实现，含服务端/客户端/单测/README/bundle 补丁） | `<本仓>/packages/reveal/`（若沿用旧目录则是 `dsh-plugin-reveal/`） |
| 已装进本机 profile | `~/.dsh/profiles/web` 的 `dependencies` 里是 `link:` 到本仓 `packages/reveal`；`dsh.profile.bundles` 里有 `dsh-plugin-reveal` |
| 本机环境 | macOS / Node 24（nvm）/ pnpm 10.15.0 / DSH 0.1.5-rc.2 |
| 待办 | 删旧仓 → 重建 → 推；之后按 §5 逐步实现 |

**不要动**：`dsh-console` 那个仓（另一个项目，有 3 个未合并的 PR）。本项目的改动只在本仓。

---

## 9. 需要人定的开放问题

1. `npm whoami` 是谁？`@yozica` scope 归不归你（要不要建 org）？→ 决定发布脚本能不能跑通。
2. 旧仓删除由**人**来做（需要 `delete_repo` 权限）；删完通知实现方重建。
3. 第二个插件做什么（阶段 2 的验收对象）—— 建议挑一个真实需求，别为造而造。

---

## 附录 A：参考实现的关键片段（`reveal`）

**服务端（工具 + SSE 频道）**

```js
export const inject = ['tools', 'webServer', 'fs'];
export function apply(ctx) {
  const connections = new Set();
  const broadcast = (frame) => { const line = sseData(frame); let n = 0;
    for (const res of connections) { try { res.write(line); n += 1; } catch { connections.delete(res); } } return n; };
  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'exact', path: '/plugin-reveal/events',
      handler: (req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': channel\n\n'); connections.add(res); res.on('close', () => connections.delete(res)); } });
    return () => { dispose(); for (const r of connections) { try { r.destroy(); } catch {} } connections.clear(); };
  }, 'plugin-reveal: events channel');
  ctx.tools.register(defineTool({ name: 'reveal', description: '在右侧栏打开文件给人看…',
    parameters: { path: { type: 'string', required: true }, line: { type: 'integer' } },
    output: { schema: { type: 'object', additionalProperties: false,
      properties: { opened: { type: 'boolean', required: true }, path: { type: 'string', required: true }, clients: { type: 'integer', required: true } } },
      render: (_a, v) => [{ type: 'text', text: v.opened ? `已打开 ${v.path}` : `没能打开 ${v.path}` }] },
    async execute(args, exec) {
      const s = exec.agent.session; const cwd = s.header.cwd;
      const entry = await ctx.fs.lstat(args.path, { cwd }, exec.signal);
      if (!entry || entry.type !== 'file') throw new Error(`reveal：不是常规文件：${args.path}`);
      const clients = broadcast({ type: 'reveal', address: fileAddressFor(s.header.id, cwd, args.path), path: args.path, line: args.line ?? null });
      return { opened: clients > 0, path: args.path, clients };
    } }));
}
```

**客户端（订阅 + 打开）**

```js
exports.inject = ['sidebarRight'];
exports.apply = function apply(ctx) {
  const source = new EventSource('/plugin-reveal/events');
  source.addEventListener('message', (e) => {
    let frame; try { frame = JSON.parse(e.data); } catch { return; }
    if (!frame || frame.type !== 'reveal' || typeof frame.address !== 'string') return;
    try { ctx.sidebarRight.openResource(frame.address); } catch (err) { console.warn('[reveal]', err); }
  });
  if (typeof ctx.effect === 'function') ctx.effect(() => () => source.close());
};
```

**已跑通的端到端证据**：用真实会话 id 推一帧真实路径 → **右侧栏打开该文件并把 HTML 当页面渲染**（以截图为准）。
**没验到的**：agent 真的调用 `reveal`（工具注册成功；`execute` 里的广播就是被验证过的那一条路径）——
实现完成后请在**新会话**里让模型真调一次。

---

## 附录 B：命令速查

```bash
# 本地
pnpm install && pnpm -r test && pnpm build
node scripts/install-dev.mjs packages/reveal      # 把某个包 link 进 profile（开发）
pnpm pack:all                                     # 打 tarball 到 .release/
pnpm e2e                                          # 端到端（见 §6.2）

# 装进 dsh（四种 spec 都吃）
dsh plugin --profile web add <目录|tgz|github:…|包名>
dsh plugin --profile web remove <包名>

# 排查
dsh web --dump-config | grep -A2 '<包名>'
curl -N http://127.0.0.1:<port>/plugins/events | head -c 400000 | grep '<包名>'   # 客户端半边是否登记
```
