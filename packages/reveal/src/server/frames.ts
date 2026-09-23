/**
 * 帧的组装（纯函数，单测直接钉）。
 *
 * 地址由**服务端**算好再推给浏览器：这样浏览器那半只需要一个
 * `openResource(address)`，不必再注入 sessions 服务去查 cwd —— 桥越窄越耐改。
 */
import { fileAddressFor } from '@yozica/dsh-plugin-kit';

import type { RevealFrame } from '../shared/endpoints.js';

/** 组装一帧；缺会话 id 或路径就抛（调用方拦住，别推坏帧） */
export function revealFrame(input: {
  sessionId: string;
  cwd?: string;
  path: string;
  line?: number;
}): RevealFrame {
  if (typeof input.sessionId !== 'string' || input.sessionId === '')
    throw new Error('reveal：缺少会话 id');
  if (typeof input.path !== 'string' || input.path.trim() === '')
    throw new Error('reveal：缺少文件路径');
  const line = typeof input.line === 'number' && Number.isFinite(input.line) ? input.line : null;
  return {
    type: 'reveal',
    address: fileAddressFor(input.sessionId, input.cwd, input.path),
    path: input.path,
    line,
  };
}
