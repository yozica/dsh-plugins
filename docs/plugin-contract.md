# DSH 插件契约（写新插件前先读这一份）

这一份是 2026-09-22 在 **DSH 0.1.5-rc.2** 上真机核对出来的（写 `reveal` 那次），不是从文档抄的。
DSH 还在 rc 阶段，**内部 API 会变** —— 每节末尾都写了"它变了会怎样"，升级 dsh 时按这张表复查。

## 1. 一个插件的形状

```
<包名>/
  package.json
    main                 服务端半边（cordis 插件）
    exports["./client"]  浏览器半边（客户端模块）
    dsh.bundle.patch     自带一层 cordis.patch.yml → 装进 profile 的 dsh.profile.bundles
    dsh.client           { platform: 'web', inject: [宿主客户端包名…] }
    dependencies         普通依赖；DSH 内部包（@deepseek-ai/dsh-tools 等）也写这里
  cordis.patch.yml       `- insert: [{ id, name }]` —— 把自己这行挂进 loader
  lib/index.js           服务端
  lib/client.js          客户端
```

**只写一半也合法**：纯客户端插件（只加界面）不要 `main` 的副作用；纯服务端插件不写 `dsh.client`。
`dsh.bundle` 决定它是不是"一层"（bundle 装法）；不写它就是普通依赖，得靠 profile 自己的补丁层挂。

### 服务端半边

```js
export const name = 'plugin-xxx';            // 稳定 id（loader 认的是包名，这个给日志/服务用）
export const inject = ['tools', 'webServer', 'fs'];   // 需要的宿主服务
export function apply(ctx) { … }              // 注册工具 / 路由 / 监听…
```

- 要注册 agent 工具：`ctx.tools.register(defineTool({ name, description, parameters, output, execute }))`，
  `defineTool` 从 `@deepseek-ai/dsh-tools` 拿（它做 schema 转换与参数校验，**不要**自己拼 tool 对象）。
- 要加 HTTP 路由：`ctx.webServer.register({ kind: 'exact', path, handler })`；
  服务端 → 浏览器推数据最省事的是 **SSE**（`dsh-client-hmr` 的 `/plugins/events` 就是范例）。
- 清理一律用 `ctx.effect(() => () => { …dispose })`，别把 dispose 散在各处。
- 工具里拿会话：`exec.agent.session` → `session.header.id` / `session.header.cwd`；
  查文件用 `ctx.fs.lstat(path, { cwd }, exec.signal)`。

### 客户端半边

```js
window.__ModuleLoader__.load({
  id: '<包名>',
  factory: () => {
    var module = { exports: {} };
    var exports = module.exports;
    exports.name = 'plugin-xxx';
    exports.inject = ['sidebarRight'];          // ← 服务名（不是包名）
    exports.apply = function apply(ctx) { … };
    return module.exports;
  },
});
```

- 这层包装要**手写**（官方包是构建产物）。本地插件没有构建步骤，别用 `import`。
- `ctx.sidebarRight` 是 DSH 有意暴露的**跨插件面**（注释原话 _Cross-plugin right-Sidebar face_）：
  `openResource(address, options?)` / `openTab(kind, options?)` / `focus`。
- 客户端能 `require('@deepseek-ai/dsh-client-*')` —— 那些包自带客户端面；
  但 `dsh-util-workspace-path` 这类**没有客户端面**的包在浏览器里 require 不到，
  要用它的纯函数就**抄一份**（地址语法就是这种情况，见 `packages/reveal/lib/address.js`）。
- `dsh.client.inject` 里写的是**宿主包的包名**（如 `@deepseek-ai/dsh-client-ui-sidebar-right`），
  只声明加载顺序，**不要**把它装成依赖。

## 2. 地址：文件怎么被"打开"

```
dsh-resource://file/session/<sessionId>/<path>
```

- 工作区**内**的绝对路径会削成相对路径；工作区**外**的保留前导 `/`（于是地址里出现两个斜杠）——
  这是对的：解析回来才是 `/tmp/x.png` 这个绝对路径，少了它就变成相对工作区的另一个文件。
- 出处：`@deepseek-ai/dsh-util-workspace-path` 的 `fileAddressFor` / `sessionFileAddress`。
- **变了会怎样**：地址无效 → 面板打开空白或报错。

## 3. 依赖解析（最容易翻车的一处）

- **workspace 里开发**（本仓库）：`pnpm install` 把 `@deepseek-ai/dsh-tools` 等装在**仓库根**的
  node_modules，`packages/*` 从自己的位置往上走能解析到 ✓ 不需要任何手工链接。
- **`link:` 装进 profile**：插件真身在仓库里，也能解析到上面那份根 node_modules（只要同机同仓）。
- **tarball / registry 装**：pnpm 把包**拷进** profile，并按 `dependencies` 把它自己的依赖装进去 ✓。
- **坑**（真机踩过）：把 DSH 内部包只写成 `peerDependencies`，然后用 `link:`/裸目录装 →
  ESM 从插件位置往上找不到 → **dsh 直接起不来**，报
  `Cannot find package '@deepseek-ai/dsh-tools' imported from …/lib/index.js`。
  兜底办法：`node scripts/link-peers.mjs <dsh 安装目录>`（一定要显式传，机器上有多个 Node 就有多份 dsh）。

## 4. 装上之后怎么生效

- `dsh plugin --profile web add <spec>` 会改 profile 的 `package.json`（依赖）与
  `dsh.profile.bundles`（声明了 `dsh.bundle` 时）；`add` / `remove` / `update` 都吃
  **目录 / tarball / git / 包名** 四种 spec。
- **重启 dsh 才生效**：bundle 列表、服务端行都是启动时装的。
- **客户端模块与 agent 工具面是会话启动时定下的** —— 已经在跑的那个会话不会凭空多出你的工具：
  **新开一个会话**再试。

## 5. 验证一个新插件的清单（照做，别只靠"看起来在跑"）

1. `pnpm -r test`：纯逻辑单测过。
2. `dsh web --dump-config | grep <你的 id>`：loader 认了这一行。
3. 起一次 dsh：**启动日志里没有** `failed to import loader entry <你的 id>`。
4. 客户端半边登记了：`curl -N http://127.0.0.1:<port>/plugins/events | grep <包名>` 的 graph 帧里
   能看到 `{"id":"<包名>","url":"/plugins/??<包名>/client.js…"}`。
5. 端到端：让 agent 真的调一次你的工具（**新会话**），或者给工具配一个只允许本机访问的测试口，
   从服务端推一帧、看界面是否真的响应。

## 6. 工具面之外

- 别把"会话"当成全局：同一个 dsh 可能同时开着多个界面/会话，一条通知该推给谁由你自己定
  （`reveal` 的选择是推给所有界面，地址里带 sessionId，界面自己解析）。
- 失败姿态要克制：插件的任何一步坏掉都**不该影响会话** —— 工具回报"没成功"和原因，客户端收不到帧就是没反应。
