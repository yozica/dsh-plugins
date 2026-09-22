/**
 * dsh-plugin-reveal —— 给 agent 一个「把文件摊开给人看」的动作：`reveal(path)`。
 *
 * 为什么需要插件：DSH 给 agent 的工具面里只有 `present`（声明交付物、在对话里放一张卡片），
 * 而"打开右侧栏面板"的能力全在**客户端**（`@deepseek-ai/dsh-client-ui-sidebar-right` 提供的
 * 跨插件面 `ctx.sidebarRight`，含 `openResource`）。两边都在，中间没有桥 —— 这个包就是那座桥：
 *
 *   agent 调 reveal(path)
 *     → 服务端确认文件存在、把路径按 DSH 的地址语法拼成 `dsh-resource://file/…`
 *     → 经 SSE（`/plugin-reveal/events`）把一帧推给所有打开的界面
 *     → 浏览器那一半（lib/client.js）收到帧就 `ctx.sidebarRight.openResource(address)`
 *
 * 依赖的内部 API（都在 DSH 0.1.5-rc.2 上核对过，升级时优先复查这几处，见 README）：
 *   - `ctx.tools.register(defineTool({...}))`（照 `@deepseek-ai/dsh-tool-present` 的写法）
 *   - `ctx.webServer.register({ kind: 'exact', path, handler })` + SSE 广播（照 `dsh-client-hmr`）
 *   - `ctx.fs.lstat(path, { cwd }, signal)`：确认那是常规文件
 *   - 地址语法 `dsh-resource://file/session/<sessionId>/<path>`（`dsh-util-workspace-path`）
 *   - 客户端：`ctx.sidebarRight.openResource(address[, { params: { line } }])`
 *
 * 失败姿态：任何一步出问题都**不影响会话** —— 工具只是回报"没打开"和原因；客户端收不到帧就是
 * 没反应（不报错刷屏）；面板打不开时工具仍然返回结果，不会把会话卡住。
 *
 * @module dsh-plugin-reveal
 */
import { defineTool } from '@deepseek-ai/dsh-tools';

import { isLoopback, revealFrame, sseData } from './address.js';

export {
  fileAddressFor,
  isAbsoluteWorkspacePath,
  isLoopback,
  revealFrame,
  sessionFileAddress,
  sseData,
} from './address.js';

export const name = 'plugin-reveal';
export const inject = ['tools', 'webServer', 'fs'];

/** 浏览器那一半连的 SSE 通道 */
export const EVENTS_ENDPOINT = '/plugin-reveal/events';
/** 维护用的测试口：只允许本机访问，用来验证"服务端 → 浏览器 → 面板打开"这条链路 */
export const PUSH_ENDPOINT = '/plugin-reveal/push';

/**
 * 挂上工具与 SSE 通道。
 *
 * @param ctx - 插件上下文（agent 面：`tools` / `webServer` / `fs`）
 */
export function apply(ctx) {
  /** 当前连着的浏览器（同一个会话可能在多个窗口开着 → 每帧推给所有界面） */
  const connections = new Set();

  const broadcast = (frame) => {
    const line = sseData(frame);
    let clients = 0;
    for (const res of connections) {
      try {
        res.write(line);
        clients += 1;
      } catch {
        connections.delete(res);
      }
    }
    return clients;
  };

  ctx.effect(() => {
    const disposeEvents = ctx.webServer.register({
      kind: 'exact',
      path: EVENTS_ENDPOINT,
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405);
          res.end();
          return;
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(': reveal channel\n\n');
        connections.add(res);
        res.on('close', () => connections.delete(res));
      },
    });

    const disposePush = ctx.webServer.register({
      kind: 'exact',
      path: PUSH_ENDPOINT,
      handler: (req, res) => {
        if (!isLoopback(req)) {
          res.writeHead(403);
          res.end('loopback only');
          return;
        }
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const line = url.searchParams.get('line');
        try {
          const frame = revealFrame({
            sessionId: url.searchParams.get('sessionId') ?? '',
            cwd: url.searchParams.get('cwd') ?? undefined,
            path: url.searchParams.get('path') ?? '',
            line: line === null ? undefined : Number(line),
          });
          const clients = broadcast(frame);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ clients, frame }));
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: String(error?.message ?? error) }));
        }
      },
    });

    return () => {
      disposePush();
      disposeEvents();
      for (const res of connections) {
        try {
          res.destroy();
        } catch {
          /* 已经断了 */
        }
      }
      connections.clear();
    };
  }, 'plugin-reveal: /plugin-reveal/events channel');

  ctx.tools.register(
    defineTool({
      name: 'reveal',
      description:
        '在 DeepSeek Harness 界面的右侧栏里打开一个文件给人看：HTML 当页面预览、图片直接显示、' +
        '文本与代码带高亮。想让用户"看到"某个文件时用它（预览页、截图、报告、日志），' +
        '而不是只在回复里报路径。文件必须已经存在。它只负责"打开"，不改变文件内容。',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: '要打开的文件路径：绝对路径，或相对会话工作区的路径',
        },
        line: {
          type: 'integer',
          description: '可选：打开后跳到这一行（从 1 开始）',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            opened: { type: 'boolean', required: true },
            path: { type: 'string', required: true },
            clients: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.opened
              ? `已在右侧栏打开 ${value.path}`
              : `没能打开 ${value.path}：当前没有连着的界面（DSH 界面关着？）`,
          },
        ],
      },
      async execute(args, exec) {
        const session = exec.agent?.session;
        if (session === undefined) throw new Error('reveal：需要 agent 会话');
        const sessionId = session.header?.id;
        const cwd = session.header?.cwd;
        if (typeof sessionId !== 'string' || sessionId === '') {
          throw new Error('reveal：这个会话没有 id，打不开面板');
        }
        if (typeof args.path !== 'string' || args.path.trim() === '') {
          throw new Error('reveal：路径不能为空');
        }
        // 先确认它真的是个常规文件：路径写错时给模型一句能自己修的错，而不是静默没反应
        const entry = await ctx.fs.lstat(args.path, { cwd }, exec.signal);
        if (entry === undefined) throw new Error(`reveal：文件不存在：${args.path}`);
        if (entry.type !== 'file') throw new Error(`reveal：不是常规文件：${args.path}`);
        const frame = revealFrame({ sessionId, cwd, path: args.path, line: args.line });
        const clients = broadcast(frame);
        return { opened: clients > 0, path: args.path, clients };
      },
    }),
  );
}
