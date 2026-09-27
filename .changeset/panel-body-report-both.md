---
'@yozica/dsh-plugin-panel-body': patch
---

诊断出口改为**双写**：`console.warn/error` 与 `ctx.logger` 各一份。

原来 6 处诊断只走 `ctx.logger`。而它是 cordis 的 exporter 模型 —— 浏览器侧那个 exporter 只把消息
**push 进内存环形缓冲**（既没有日志面板、也不落盘），等于写进去没人看得见：用户遇到问题时
我们手里什么证据都没有。

现在统一走一个 `report()` helper：先 `console.warn`（进浏览器控制台；**在 DSH Console 里**
这条路会把消息抓进 `%APPDATA%\DSH Console\logs\console.log`），再 `ctx.logger`（dsh 自己那份）。
换任何宿主跑，至少浏览器控制台里有一份。

顺带修掉改名漏网的一处：右下角失败提示的 `[paths]` → `[panel-body]`。
