export interface SuperAssistantTask {
  id: string;
  projectId: string;
  projectName: string;
  conversationId: string;
  title: string;
  prompt: string;
  status: 'queued' | 'running' | 'waiting' | 'finished' | 'failed' | 'canceled';
  createdAt: number;
  updatedAt: number;
  summary?: string;
  error?: string;
}

export interface SuperAssistantSnapshot {
  ok: boolean;
  conversationId?: string;
  tasks: SuperAssistantTask[];
  error?: string;
}
