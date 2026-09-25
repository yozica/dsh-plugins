/**
 * 把"点到的路径"变成"右侧栏能打开的地址"。
 *
 * 相对路径的规则（`docs/panel-path-links.md` 里定的）：
 *
 * 1. 先按**当前文件所在目录**解析；
 * 2. 再按**工作区根**解析；
 * 3. 都读不到就把"相对当前文件目录"那个交给宿主 —— 由宿主自己报"没找到"，
 *    比我们自己编一句错误更准（宿主知道工作区根在哪）。
 *
 * 存在性检查是**尽力而为**：拿不到 `remote.workspaceFiles` 时不做检查，直接按规则 1 打开。
 *
 * @module @yozica/dsh-plugin-paths/target
 */
import { isWindowsStylePath, sessionFileAddress } from '@yozica/dsh-plugin-kit/client';

import { relativeCandidates, type PathTarget } from './paths.js';

export interface OpenTargetContext {
  readonly sessionId: string;
  /** 当前正文文件在工作区里的路径（相对或绝对） */
  readonly filePath: string;
  /** 可选的存在性检查（相对或绝对路径 → 能不能读到） */
  readonly exists?: (path: string) => Promise<boolean>;
  readonly open: (address: string, line?: number) => void;
}

/** 解析并打开一个路径；返回最终用的地址（测试与日志用） */
export async function openFileTarget(
  context: OpenTargetContext,
  target: PathTarget,
): Promise<string> {
  const normalized = target.path.replace(/\\/g, '/');
  const absolute =
    normalized.startsWith('/') || normalized.startsWith('~/') || isWindowsStylePath(normalized);

  let chosen = normalized;
  if (!absolute) {
    const candidates = relativeCandidates(context.filePath, normalized);
    chosen = candidates[0] ?? normalized;
    if (context.exists !== undefined) {
      for (const candidate of candidates) {
        let found = false;
        try {
          found = await context.exists(candidate);
        } catch {
          found = false; // 读失败就当下一个候选，别让一次探测打断点击
        }
        if (found) {
          chosen = candidate;
          break;
        }
      }
    }
  }

  const address = sessionFileAddress(context.sessionId, chosen);
  context.open(address, target.line);
  return address;
}
