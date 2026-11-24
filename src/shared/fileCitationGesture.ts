import type { OpenFileCitationIntent, SaveFileCitationRequest } from './types/filesWorkspace';

export type FileCitationGesture = 'open' | 'save';

export function openCitationGestureKey(request: OpenFileCitationIntent): string {
  return JSON.stringify([request.conversationId, request.projectId, request.action, request.path]);
}

export function saveCitationGestureKey(request: Omit<SaveFileCitationRequest, 'content'>): string {
  return JSON.stringify([
    request.conversationId,
    request.projectId,
    request.citationId,
    request.revision,
  ]);
}
