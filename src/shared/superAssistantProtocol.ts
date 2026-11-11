/** Closed worker/Main protocol. Identifiers are resolved against Main-owned records, never paths. */
export type SuperAssistantRequest =
  | { operation: 'list'; limit?: number }
  | { operation: 'search'; query: string; limit?: number }
  | { operation: 'history'; conversationId: string; limit?: number }
  | {
      operation: 'dispatch';
      projectId: string;
      conversationId?: string;
      prompt: string;
      title?: string;
    }
  | { operation: 'status'; taskId?: string }
  | { operation: 'cancel'; taskId: string };

export function parseSuperAssistantRequest(value: unknown): SuperAssistantRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  const text = (key: string, max = 512) =>
    typeof p[key] === 'string' &&
    (p[key] as string).trim().length > 0 &&
    (p[key] as string).length <= max;
  const keys = (...allowed: string[]) =>
    Object.keys(p).every((key) => ['operation', ...allowed].includes(key));
  const limit = () =>
    p.limit === undefined ||
    (Number.isInteger(p.limit) && Number(p.limit) >= 1 && Number(p.limit) <= 100);
  let valid = false;
  switch (p.operation) {
    case 'list':
      valid = keys('limit') && limit();
      break;
    case 'search':
      valid = keys('query', 'limit') && text('query', 2000) && limit();
      break;
    case 'history':
      valid = keys('conversationId', 'limit') && text('conversationId', 128) && limit();
      break;
    case 'dispatch':
      valid =
        keys('projectId', 'conversationId', 'prompt', 'title') &&
        text('projectId', 128) &&
        text('prompt', 32_000) &&
        (p.conversationId === undefined || text('conversationId', 128)) &&
        (p.title === undefined || text('title', 200));
      break;
    case 'status':
      valid = keys('taskId') && (p.taskId === undefined || text('taskId'));
      break;
    case 'cancel':
      valid = keys('taskId') && text('taskId');
      break;
  }
  return valid ? (p as SuperAssistantRequest) : null;
}
