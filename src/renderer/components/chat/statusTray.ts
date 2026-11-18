import { projectDisplayName } from '@shared/projectName';

/**
 * 输入框下方托盘的左侧：我在哪台机器、哪个项目、哪个分支。
 *
 * 这三项都是「定位」而不是「统计」，所以不参与 `statusLineSegments` 的可配置段位——
 * 关掉它就不知道自己改的是哪份代码。右侧的用量段位才由用户拖拽排序。
 */

/**
 * 这一段只在「代码不在这台机器上」时才有信息量，所以本地项目返回 null、整段不渲染：
 * 本机是常量，天天挂一个「这台 Mac」等于什么都没说。
 *
 * 远端项目显示连接名，回落到 `user@host`。用字段有无判断远端比 `kind` 更宽容
 * （历史数据可能缺 kind），本地项目的 `sshHost`/`sshConnectionName` 恒为空。
 */
export function hostLabel(
  project:
    | { sshConnectionName?: string; sshHost?: string; kind?: 'local' | 'ssh' | 'scratch' }
    | undefined
): string | null {
  const named = project?.sshConnectionName?.trim();
  if (named) return named;
  const target = project?.sshHost?.trim();
  if (target) return target;
  return null;
}

export interface TrayPlace {
  /** 项目展示名；临时会话为 null。 */
  project: string | null;
  /** 临时会话（scratch）：不挂项目名，只标临时。 */
  temporary: boolean;
}

/** 项目那一段：临时会话的承载目录不是用户的项目，不冒充项目名。 */
export function trayPlace(
  project:
    | { name: string; path: string; alias?: string; kind?: 'local' | 'ssh' | 'scratch' }
    | undefined
): TrayPlace {
  if (!project) return { project: null, temporary: false };
  if (project.kind === 'scratch') return { project: null, temporary: true };
  return { project: projectDisplayName(project), temporary: false };
}
