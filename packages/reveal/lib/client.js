// 由 @yozica/dsh-plugin-kit/build 生成 —— 不要手改这个文件，改 src/client/。
window.__ModuleLoader__.load({
  id: "@yozica/dsh-plugin-reveal",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    "use strict";
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name2 in all)
        __defProp(target, name2, { get: all[name2], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // src/browser.ts
    var browser_exports = {};
    __export(browser_exports, {
      apply: () => apply,
      inject: () => inject,
      name: () => name,
      parseRevealFrame: () => parseRevealFrame
    });
    module.exports = __toCommonJS(browser_exports);

    // ../kit/lib/services.js
    var DSH_TESTED_VERSION = "0.1.5-rc.2";
    function requireClientServices(ctx, names) {
      const record = ctx;
      const missing = names.filter((name2) => record[name2] === void 0 || record[name2] === null);
      if (missing.length > 0) {
        ctx.logger?.warn(`[dsh-plugin-kit] \u8FD9\u4E2A\u754C\u9762\u7F3A\u5C11\u670D\u52A1\uFF1A${missing.join(", ")}\uFF08kit \u662F\u6309 ${DSH_TESTED_VERSION} \u6838\u5BF9\u7684\uFF09\u3002`);
      }
      return { ok: missing.length === 0, missing };
    }

    // ../kit/lib/client.js
    function subscribeSse(ctx, path, onFrame) {
      if (typeof EventSource !== "function")
        return () => {
        };
      const source = new EventSource(path);
      source.addEventListener("message", (event) => {
        let frame;
        try {
          frame = JSON.parse(String(event.data));
        } catch {
          return;
        }
        try {
          onFrame(frame);
        } catch (error) {
          ctx.logger?.warn("[dsh-plugin-kit] \u5904\u7406\u63A8\u9001\u65F6\u51FA\u9519\uFF1A", error);
        }
      });
      const close = () => source.close();
      if (typeof ctx.effect === "function")
        ctx.effect(() => close);
      return close;
    }
    function openResource(ctx, address, line) {
      const { ok } = requireClientServices(ctx, ["sidebarRight"]);
      if (!ok)
        return false;
      const sidebar = ctx.sidebarRight;
      try {
        if (line === void 0)
          sidebar?.openResource(address);
        else
          sidebar?.openResource(address, { params: { line } });
        return true;
      } catch (error) {
        ctx.logger?.warn("[dsh-plugin-kit] \u6253\u5F00\u53F3\u4FA7\u680F\u5931\u8D25\uFF1A", error);
        return false;
      }
    }

    // src/shared/endpoints.ts
    var EVENTS_ENDPOINT = "/plugin-reveal/events";

    // src/browser.ts
    var name = "plugin-reveal";
    var inject = ["sidebarRight"];
    function parseRevealFrame(value) {
      if (typeof value !== "object" || value === null) return null;
      const record = value;
      if (record.type !== "reveal") return null;
      if (typeof record.address !== "string" || record.address === "") return null;
      const line = typeof record.line === "number" && Number.isFinite(record.line) ? record.line : null;
      return { type: "reveal", address: record.address, path: String(record.path ?? ""), line };
    }
    function apply(ctx) {
      subscribeSse(ctx, EVENTS_ENDPOINT, (raw) => {
        const frame = parseRevealFrame(raw);
        if (frame === null) return;
        openResource(ctx, frame.address, frame.line ?? void 0);
      });
    }

    return module.exports;
  },
});
