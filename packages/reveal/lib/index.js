/**
 * `@yozica/dsh-plugin-reveal` —— 给 agent 一个「把文件摊开给人看」的动作：`reveal(path)`。
 *
 * 服务端半边：注册 agent 工具 + 一条 SSE 频道（浏览器那半在 `src/browser.ts`）。
 * 两半之间的桥、地址语法、工具定义都由 `@yozica/dsh-plugin-kit` 提供 ——
 * 这个包**不 import 任何 @deepseek-ai/* **，所以能发到公共源、谁的 DSH 都能装。
 *
 * @module @yozica/dsh-plugin-reveal
 */
import { createSseChannel, defineTool, isLoopback, requireServerServices, } from '@yozica/dsh-plugin-kit';
import { EVENTS_ENDPOINT, PUSH_ENDPOINT } from './shared/endpoints.js';
import { revealFrame } from './server/frames.js';
export const name = 'plugin-reveal';
export const inject = ['tools', 'webServer', 'fs'];
export function apply(ctx) {
    requireServerServices(ctx, ['tools', 'webServer', 'fs']);
    const channel = createSseChannel(ctx);
    ctx.effect?.(() => {
        const disposeEvents = channel.register(EVENTS_ENDPOINT);
        // 维护用测试口：只允许本机。用途是"不经过模型"地验证整条链路（见 README 的验证段）。
        const webServer = ctx.webServer;
        const disposePush = webServer?.register({
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
                    const clients = channel.broadcast(frame);
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ clients, frame }));
                }
                catch (error) {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ error: String(error.message ?? error) }));
                }
            },
        });
        return () => {
            disposePush?.();
            disposeEvents();
            channel.dispose();
        };
    }, 'plugin-reveal: events channel');
    ctx.tools?.register(defineTool({
        name: 'reveal',
        description: '在 DeepSeek Harness 界面的右侧栏里打开一个文件给人看：HTML 当页面预览、图片直接显示、' +
            '文本与代码带高亮。想让用户"看到"某个文件时用它（预览页、截图、报告、日志），' +
            '而不是只在回复里报路径。文件必须已经存在。它只负责"打开"，不改变文件内容。',
        parameters: {
            path: {
                type: 'string',
                required: true,
                description: '要打开的文件路径：绝对路径，或相对会话工作区的路径',
            },
            line: { type: 'integer', description: '可选：打开后跳到这一行（从 1 开始）' },
        },
        output: {
            schema: {
                opened: { type: 'boolean', required: true },
                path: { type: 'string', required: true },
                clients: { type: 'integer', required: true },
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
            if (session === undefined)
                throw new Error('reveal：需要 agent 会话');
            const sessionId = session.header.id;
            const cwd = session.header.cwd;
            if (typeof sessionId !== 'string' || sessionId === '') {
                throw new Error('reveal：这个会话没有 id，打不开面板');
            }
            // 先确认它真的是个常规文件：路径写错时给模型一句能自己修的错，而不是静默没反应
            const entry = await ctx.fs?.lstat(args.path, { cwd }, exec.signal);
            if (entry === undefined)
                throw new Error(`reveal：文件不存在：${args.path}`);
            if (entry.type !== 'file')
                throw new Error(`reveal：不是常规文件：${args.path}`);
            const frame = revealFrame({ sessionId, cwd, path: args.path, line: args.line });
            const clients = channel.broadcast(frame);
            return { opened: clients > 0, path: args.path, clients };
        },
    }));
}
