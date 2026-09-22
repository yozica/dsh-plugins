/**
 * dsh-plugin-reveal 的浏览器那一半。
 *
 * 它只做一件事：订阅服务端的 SSE 通道，收到 `{type:'reveal', address, line}` 就调
 * `ctx.sidebarRight.openResource(address[, { params: { line } }])` —— 面板就打开了。
 * （`ctx.sidebarRight` 是 `@deepseek-ai/dsh-client-ui-sidebar-right` 提供的**跨插件面**，
 * DSH 自己的对话页打开文件走的也是这一个调用。）
 *
 * 这个文件是**手写的 loader 包装**（和 `@deepseek-ai/dsh-client-ui-*` 那些包编译出来的形状一致）：
 * 客户端模块由 `window.__ModuleLoader__` 装载，不是浏览器原生 ESM —— 本地插件没有构建步骤，
 * 所以这层包装得自己写。
 *
 * 失败姿态：连不上 / 帧不合法 / 打开报错，都只 `console.warn` 一次，绝不影响界面。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-reveal',
  factory: () => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    /** 与服务端同一个通道（见 lib/index.js 的 EVENTS_ENDPOINT） */
    var ENDPOINT = '/plugin-reveal/events';

    /** 客户端服务名：右栏（`@deepseek-ai/dsh-client-ui-sidebar-right` 提供） */
    var inject = ['sidebarRight'];

    /** 校验一帧，别让坏 JSON 碰状态 */
    function parseFrame(value) {
      if (typeof value !== 'object' || value === null) return null;
      if (value.type !== 'reveal') return null;
      if (typeof value.address !== 'string' || value.address === '') return null;
      return {
        address: value.address,
        line: typeof value.line === 'number' && Number.isFinite(value.line) ? value.line : null,
      };
    }

    function apply(ctx) {
      if (typeof EventSource !== 'function') return;
      var source = new EventSource(ENDPOINT);
      var warned = false;

      source.addEventListener('message', function (event) {
        var frame;
        try {
          frame = parseFrame(JSON.parse(event.data));
        } catch (error) {
          return;
        }
        if (frame === null) return;
        try {
          if (frame.line === null) ctx.sidebarRight.openResource(frame.address);
          else ctx.sidebarRight.openResource(frame.address, { params: { line: frame.line } });
        } catch (error) {
          if (!warned) {
            warned = true;
            console.warn('[reveal] 打开失败：', error);
          }
        }
      });

      if (typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return function () {
            source.close();
          };
        });
      }
    }

    exports.ENDPOINT = ENDPOINT;
    exports.apply = apply;
    exports.inject = inject;
    exports.name = 'plugin-reveal';
    return module.exports;
  },
});
