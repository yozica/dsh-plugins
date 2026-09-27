/**
 * 服务端半边：这个包目前只需要"被装配" —— 能力全在浏览器半边（接管侧栏的 body）。
 *
 * 之所以仍然保留一个最小实现：bundle 的 patch 需要它能在 loader 里插进来，
 * `scripts/check-dist.mjs` 也要能断言服务端产物的形状（name / inject / apply）。
 * 将来若要加服务端能力（例如按文件类型给出可点规则），落点在这里。
 *
 * @module @yozica/dsh-plugin-panel-body
 */
export const name = 'plugin-panel-body';

export const inject: readonly string[] = [];

export function apply(): void {
  // 暂不做任何服务端动作。
}
