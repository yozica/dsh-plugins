/**
 * 所有**用户可见文案**都放这一处。
 *
 * 为什么要单独一个文件（这是从 `dshmarket` 学的）：那个包**一句文案都不硬编码** ——
 * 它注册一个 locale 命名空间（`ctx.locale.register(NS, { zh, en })`）再 `bind` 出 `t`，
 * 连错误边界的四个字符串都由外面传进去。我们暂时不注册 locale（那要给 `inject` 加
 * `locale`，而 `inject` 里多一个拿不到的服务会让整个 fiber 静默不激活，代价我们已经付过一次），
 * 但至少把文案收在一处：将来要接 `ctx.locale` 时**只改这个文件**。
 *
 * @module @yozica/dsh-plugin-panel-body/strings
 */
export const STRINGS = {
  /** 查看器菜单里我们的名字（官方是 `Markdown` / `HTML`，我们用后缀区分） */
  markdownTitle: 'Markdown · panel-body',
  htmlTitle: 'HTML · panel-body',
  /** 可点路径的 tooltip */
  openPathTitle: (path: string, line?: number): string =>
    `在侧栏打开 ${path}${line === undefined ? '' : `:${line}`}`,
  /** HTML 预览的三种状态 */
  htmlLoading: '正在准备 HTML 预览…',
  htmlFailed: '无法预览这份 HTML 文档。',
  htmlFrame: 'HTML 文档预览',
  /** 错误边界兜底（渲染崩了不该白屏） */
  renderCrash: '这份内容渲染出错，已退回显示原文。',
  /** 右下角失败提示 */
  mountFailed: (detail: string): string => `[paths] 出错（正文交回官方渲染）：${detail}`,
  /** 日志（warn）用 */
  noSidebarService: '[dsh-plugin-panel-body] 这个界面没有 sidebarRight 服务，路径点了打不开。',
  notSessionAddress: '[dsh-plugin-panel-body] 当前正文不是 session 文件地址，解析不了相对路径：',
  mountFailedLog: '[dsh-plugin-panel-body] 客户端半边挂载失败，md / html 交回官方渲染：',
  missingReact: '[dsh-plugin-panel-body] 宿主的 react 缺少这些导出，md / html 交回官方渲染：',
  badAddress: '不是 session 文件地址',
} as const;
