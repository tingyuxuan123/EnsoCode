import path from 'node:path';

export interface DesignResourcePaths {
  /** 随包只读资源根：engine 模板、history-runner、skills、vendor。 */
  resourceRoot: string;
  /** 预装 node_modules 的引擎模板，首次使用拷到 engineBase/<版本>。 */
  engineTemplate: string;
  /** 构建产物：单文件 history runner（isomorphic-git + fflate）。 */
  historyRunner: string;
  /** 内置技能目录（含 vetta-ui-design），加入 additionalSkillPaths。 */
  skillsDir: string;
  /** 设计师角色等 agent 正文。 */
  agentsDir: string;
  /** 可写：物化后的引擎。 */
  engineBase: string;
  /** 可写：设计私有存储（方向历史、体系目录缓存）。 */
  storageDir: string;
}

export function designResourcePaths(options: {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  userDataPath: string;
}): DesignResourcePaths {
  const resourceRoot = options.packaged
    ? path.join(options.resourcesPath, 'design')
    : path.join(options.appPath, 'resources', 'design');
  const writable = path.join(options.userDataPath, 'design');
  return {
    resourceRoot,
    engineTemplate: path.join(resourceRoot, 'engine'),
    historyRunner: path.join(resourceRoot, 'history-runner', 'runner.mjs'),
    skillsDir: path.join(resourceRoot, 'skills'),
    agentsDir: path.join(resourceRoot, 'agents'),
    engineBase: path.join(writable, 'engine'),
    storageDir: path.join(writable, 'data'),
  };
}
