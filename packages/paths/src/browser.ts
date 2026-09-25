/**
 * 浏览器半边（**探针版**）：只验证一件事 —— 注册的 body 能不能真的接管侧栏里的 md / html。
 *
 * 为什么先做探针而不是直接写渲染：`key` ↔ `sidebar.right.tab.document` 槽位的对应关系是从
 * 官方 `dsh-client-ui-sidebar-documentpreview` 源码里读出来的，还没用我们自己的包跑通过一次。
 * 探针刻意**不依赖 React**：组件只打一行日志并返回 `null` ——
 *
 *   ① 日志里出现 `[paths-probe] body invoked` → 我们的 body 被调用了（接管成功）；
 *   ② 侧栏里那份 md / html 变空 → 同样是接管生效的可见信号。
 *
 * 探针通过之后再写正式实现（Markdown 渲染 + HTML iframe 桥），见 `docs/panel-path-links.md`。
 *
 * @module @yozica/dsh-plugin-paths/browser
 */
export const name = 'plugin-paths';

/** 需要宿主提供的服务：`documentPreviews`（body 注册表）、`slots`（内容槽位）。 */
export const inject = ['documentPreviews', 'slots'];

/** 只声明我们用到的形状（kit 的防火墙思路：宿主 API 的形状只在一处描述） */
interface ProbeContext {
  readonly documentPreviews: {
    register(definition: Record<string, unknown>): unknown;
  };
  readonly slots: {
    inject(name: string, callback: () => unknown): unknown;
    register(target: { name: string; key: string }, component: unknown): unknown;
  };
  effect(run: () => unknown, label?: string): unknown;
}

/** 我们接管的两种内容：扩展名 → body id 后缀 */
const TARGETS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['md', ['md', 'markdown']],
  ['html', ['html', 'htm']],
];

/**
 * 探针组件：不画任何东西，只把"我被调用了"写进页面控制台。
 *
 * 打包版里渲染层的 console 会被主进程转发到 `<userData>/logs/console.log`，
 * 所以这一行就是最直接的证据。
 */
export function probeBody(props: Record<string, unknown>): null {
  const address = typeof props.address === 'string' ? props.address : null;
  const keys = Object.keys(props).slice(0, 10);
  console.log('[paths-probe] body invoked', JSON.stringify({ address, keys }));
  return null;
}

export function apply(ctx: ProbeContext): void {
  for (const [suffix, extensions] of TARGETS) {
    const id = `${name}:${suffix}`;
    ctx.effect(
      () =>
        ctx.documentPreviews.register({
          id,
          extensions,
          priority: 'extension',
          title: () => `${suffix} · paths`,
        }),
      `paths: ${suffix} body 定义`,
    );
    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.right.tab.document', () =>
          ctx.slots.register({ name: 'sidebar.right.tab.document', key: id }, probeBody),
        ),
      `paths: ${suffix} body 组件`,
    );
  }
}
