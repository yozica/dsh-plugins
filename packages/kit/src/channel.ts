/**
 * 服务端 → 浏览器 的 SSE 频道（照 DSH 自带 `dsh-client-hmr` 的写法）。
 *
 * 用途：服务端那半（agent 工具、路由）想让浏览器那半做事时，把一帧推给所有打开的界面。
 * 官方插件就是这么干的：在 `ctx.webServer` 上挂一条 exact 路由，用 `text/event-stream` 推。
 *
 * @module @yozica/dsh-plugin-kit/channel
 */
import type { ServerContext, ServerRequest, ServerResponse } from './types.js';

/** 一帧 SSE 数据 */
export function sseData(frame: unknown): string {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

/** 只允许本机（给"维护用测试口"这种入口） */
export function isLoopback(request: ServerRequest | undefined): boolean {
  const address = request?.socket?.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export interface SseChannel {
  /** 挂上频道路由（在 `ctx.effect` 里调用） */
  register(path: string): () => void;
  /** 推一帧给所有连着的界面，返回推给了几个 */
  broadcast(frame: unknown): number;
  /** 当前连着的界面数 */
  readonly clients: number;
  /** 收尾：断开所有连接 */
  dispose(): void;
}

/**
 * 建一个频道。
 *
 * ```ts
 * const channel = createSseChannel(ctx);
 * ctx.effect(() => channel.register('/plugin-x/events'), 'plugin-x: events');
 * channel.broadcast({ type: 'x', … });
 * ```
 */
export function createSseChannel(ctx: ServerContext): SseChannel {
  const connections = new Set<ServerResponse>();
  const broadcast = (frame: unknown): number => {
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
  return {
    broadcast,
    get clients(): number {
      return connections.size;
    },
    register(path: string): () => void {
      const webServer = ctx.webServer;
      if (webServer === undefined) throw new Error('这个 DSH 没有提供 webServer 服务，推不了数据');
      return webServer.register({
        kind: 'exact',
        path,
        handler: (req: ServerRequest, res: ServerResponse) => {
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
          res.write(': channel\n\n');
          connections.add(res);
          res.on('close', () => connections.delete(res));
        },
      });
    },
    dispose(): void {
      for (const res of connections) {
        try {
          res.destroy?.();
        } catch {
          /* 已经断了 */
        }
      }
      connections.clear();
    },
  };
}
