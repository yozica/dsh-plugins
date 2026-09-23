/** 两半共用的常量（服务端编译进 lib，浏览器那半由 esbuild 打进产物） */

/** 浏览器半边连的 SSE 频道 */
export const EVENTS_ENDPOINT = '/plugin-reveal/events';
/** 维护用测试口：只允许本机，用来验证"服务端 → 浏览器 → 面板打开"这条链路 */
export const PUSH_ENDPOINT = '/plugin-reveal/push';

/** 一帧"请打开这个文件" */
export interface RevealFrame {
  type: 'reveal';
  address: string;
  path: string;
  line: number | null;
}
