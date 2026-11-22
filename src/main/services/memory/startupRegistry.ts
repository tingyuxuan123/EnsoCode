/**
 * 会话启动时的记忆摘要出入口。
 * 这里只做转发，不读数据库也不碰文件：`agentHost` 可以直接引用它，
 * 真正的实现在 `memoryHost` 里注册，避免把 sqlite / 本地模型依赖拖进 spawn 路径。
 */
export interface MemoryStartupRequest {
  projectId?: string | null;
  /** 会话工作目录；用来判断代码是否比记忆新 */
  cwd?: string | null;
}

type MemoryStartupProvider = (request: MemoryStartupRequest) => string | null;

let provider: MemoryStartupProvider | null = null;

export function setMemoryStartupProvider(next: MemoryStartupProvider | null): void {
  provider = next;
}

export function memoryStartupBlock(request: MemoryStartupRequest): string | null {
  if (!provider) return null;
  try {
    return provider(request) ?? null;
  } catch {
    return null;
  }
}
