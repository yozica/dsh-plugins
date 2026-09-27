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
 * @module @yozica/dsh-plugin-panel-body/target
 */
import { fileAddressFor, isWindowsStylePath } from '@yozica/dsh-plugin-kit/client';

import { relativeCandidates, type PathTarget } from './paths.js';

export interface OpenTargetContext {
  readonly sessionId: string;
  /** 当前正文文件在工作区里的路径（相对或绝对） */
  readonly filePath: string;
  /**
   * 把候选路径**解析成绝对路径**（解析不到给 `undefined`）。
   *
   * 注意它返回绝对路径、不是布尔：相对路径经 `..` 越过工作区根时，只有宿主说得准
   * 那个路径落到哪儿（上游的 `stat` 明确允许工作区外的路径）。返回布尔的话我们只能
   * 自己拼字符串，而拼出来的相对路径一旦越过工作区根就是错的 —— 那正是
   * 「`../../docs/x.md` 打不开」这个 bug 的成因。
   */
  readonly resolve?: (path: string) => Promise<string | undefined>;
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
    if (context.resolve !== undefined) {
      for (const candidate of candidates) {
        let resolved: string | undefined;
        try {
          resolved = await context.resolve(candidate);
        } catch {
          resolved = undefined; // 解析失败就当下一个候选，别让一次探测打断点击
        }
        if (resolved !== undefined) {
          chosen = resolved;
          break;
        }
      }
    }
  }

  // `cwd` 给 undefined：这时 `chosen` 要么是宿主解析出的绝对路径、要么本身就是绝对写法，
  // 两者都该原样编码（工作区外的绝对路径保留前导 `/`，见 kit 的 `fileAddressFor`）。
  const address = fileAddressFor(context.sessionId, undefined, chosen);
  context.open(address, target.line);
  return address;
}
