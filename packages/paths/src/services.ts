/**
 * 「从 cordis 上下文里安全读一个服务」—— 只在这一处实现。
 *
 * ## 为什么需要它（真机踩过的三连环）
 *
 * cordis 的 `ctx` 是**代理**，两条规矩方向相反、都很坑：
 *
 * 1. **没在 `inject` 里声明的服务，读一下就直接抛**
 *    （`cannot get property "X" without inject`）—— 抛在 `apply` 里就是整页
 *    `Failed to load plugins`；抛在点击回调里就是"点了没反应"；
 * 2. **`inject` 里只要有一个服务没被提供，fiber 就停在 INACTIVE，`apply` 根本不会执行**，
 *    而且**完全静默**（没日志、没报错、面板上什么都没有）。
 *
 * 还有第三个坑：**嵌套服务名是独立的服务**。官方 documentpreview 注入的是
 * `remote` *和* `remote.workspaceFiles` 两个名字；只拿到 `remote` 那个面、再读它的
 * `.workspaceFiles` 属性，一样会触发第 1 条守卫（`cannot get property "remote.workspaceFiles"
 * without inject`）。所以读嵌套服务要**直接用完整的服务名**。
 *
 * 结论：`inject` 只放"没有它就完全没意义"的服务；其余一律用
 * `ctx.reflect.get(name, false)` **非严格读取**（拿不到返回 `undefined`，不抛、也不影响 fiber 激活）。
 *
 * @module @yozica/dsh-plugin-paths/services
 */

/** 只要这几个面就能安全读服务 */
export interface ServiceHost {
  /** cordis 官方推荐：可选能力用 `ctx.get(name)` + undefined 判断 */
  get?(name: string): unknown;
  reflect?: { get?(name: string, strict?: boolean): unknown };
}

/**
 * 非严格读取一个服务：**任何情况下都不抛**，拿不到就是 `undefined`。
 *
 * 三条路依次尝试（官方/社区的正统做法在前）：
 *
 * 1. `ctx.get(name)` —— 官方教学文档原话是
 *    "Prefer ctx.get(name) with an undefined check; use inject only for hard dependencies"，
 *    社区也有实测记录（静态 inject 里塞可选服务会把整个 client boot 挂死，改用 `ctx.get` 探测）；
 * 2. `ctx.reflect.get(name, false)` —— `get` 不可用时的非严格读法；
 * 3. 普通属性读取（脱离 cordis 的假件 / 测试环境）。
 *
 * @param ctx - 插件上下文（只用它的 `get` / `reflect`）
 * @param name - 完整服务名（嵌套服务要写全，例如 `remote.workspaceFiles`）
 */
export function serviceOf<T>(ctx: ServiceHost, name: string): T | undefined {
  try {
    if (typeof ctx.get === 'function') {
      const value = ctx.get(name);
      return value === undefined || value === null ? undefined : (value as T);
    }
    const reflect = ctx.reflect;
    if (reflect !== undefined && typeof reflect.get === 'function') {
      const value = reflect.get(name, false);
      return value === undefined || value === null ? undefined : (value as T);
    }
    // 没有 get / reflect 的宿主（或测试假件）：退回普通属性读取。这一下可能被代理守卫拦，
    // 所以整段都在 try 里 —— 拿不到服务而已，不该让调用方挂。
    const value = (ctx as unknown as Record<string, unknown>)[name];
    return value === undefined || value === null ? undefined : (value as T);
  } catch {
    return undefined;
  }
}

/** 我们从宿主 `react` 里用到的东西；缺任何一个都当作"宿主太旧"，干净降级而不是渲染时炸 */
export const REQUIRED_REACT_EXPORTS = [
  'createElement',
  'Component',
  'useState',
  'useEffect',
  'useRef',
  'useMemo',
] as const;

/**
 * 宿主模块里缺哪些导出（对齐 `dshmarket` 的 `missingPrimitives` 自检）。
 *
 * 为什么需要：宿主把 `react` 当静态模块提供，**旧宿主上模块能解析、但某些导出是 undefined**；
 * 那时注册 body 会在渲染时炸成白屏，不如一开始就"少一个能力"。
 */
export function missingReact(
  module: Record<string, unknown>,
  required: readonly string[] = REQUIRED_REACT_EXPORTS,
): string[] {
  return required.filter((name) => typeof module[name] !== 'function');
}
