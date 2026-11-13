import type { DraftResult } from './draftBridge';
export interface SessionRequest {
  sessionId: string;
  op:
    | 'focusSession'
    | 'focusSubagent'
    | 'openChildRun'
    | 'createSession'
    | 'ensureSession'
    | 'openPluginView';
  payload: Record<string, unknown>;
}
export interface SessionBridgeDeps {
  conversation(id: string): { projectId: string; parentId?: string } | null;
  focus(rootId: string, target: string): void;
  focusSubagent(sessionId: string, agentId: string): boolean;
  openChildRun(parentId: string, childId: string): boolean;
  create(projectId: string, presetId?: string): Promise<string | null>;
  prefill(sessionId: string, text: string): void;
  ensure(sessionId: string): Promise<string | null>;
  openPluginView(
    sessionId: string,
    view: { pluginId: string; viewId: string; title: string }
  ): boolean;
}
const fail = (code: string, error: string): DraftResult => ({ ok: false, code, error });
/** Main authenticates the plugin; this window still resolves authoritative session identities. */
export async function handleSessionRequest(
  req: SessionRequest,
  deps: SessionBridgeDeps
): Promise<DraftResult> {
  if (!deps.conversation(req.sessionId))
    return fail('NO_SESSION', 'Originating session is not in this window');
  const origin = deps.conversation(req.sessionId);
  if (!origin) return fail('NO_SESSION', 'Originating session is not in this window');
  if (req.op === 'focusSession') {
    const target = req.payload.sessionId;
    const conversation = typeof target === 'string' ? deps.conversation(target) : null;
    if (typeof target !== 'string' || !conversation) return fail('NOT_FOUND', 'Session not found');
    deps.focus(conversation.parentId ?? target, target);
  } else if (req.op === 'focusSubagent') {
    const { sessionId, agentId } = req.payload;
    if (
      typeof sessionId !== 'string' ||
      typeof agentId !== 'string' ||
      !deps.focusSubagent(sessionId, agentId)
    )
      return fail('NOT_FOUND', 'Agent not found');
  } else if (req.op === 'openChildRun') {
    const { parentId, childId } = req.payload;
    if (
      typeof parentId !== 'string' ||
      typeof childId !== 'string' ||
      !deps.openChildRun(parentId, childId)
    )
      return fail('NOT_FOUND', 'Child session not found');
  } else if (req.op === 'ensureSession') {
    if (origin.parentId) return fail('UNSUPPORTED', 'Child sessions resume with their parent');
    const error = await deps.ensure(req.sessionId);
    if (error) return fail('SESSION_FAILED', error);
  } else if (req.op === 'openPluginView') {
    const { pluginId, viewId, title } = req.payload;
    if (
      typeof pluginId !== 'string' ||
      typeof viewId !== 'string' ||
      typeof title !== 'string' ||
      !deps.openPluginView(req.sessionId, { pluginId, viewId, title })
    )
      return fail('NOT_FOUND', 'Plugin view not found');
  } else if (req.op === 'createSession') {
    const presetId = typeof req.payload.presetId === 'string' ? req.payload.presetId : undefined;
    const id = await deps.create(origin.projectId, presetId);
    if (!id) return fail('CREATE_FAILED', 'Unable to create a session');
    if (typeof req.payload.text === 'string' && req.payload.text)
      deps.prefill(id, req.payload.text);
    return { ok: true, value: { sessionId: id } };
  } else return fail('BAD_REQUEST', 'Unknown session operation');
  return { ok: true, value: null };
}
