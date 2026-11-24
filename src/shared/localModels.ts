export interface ChatModelDto {
  id: string;
  label: string;
  params: string;
  contextSize: number;
  approxBytes: number;
  downloadedBytes: number;
  downloadable: boolean;
  state: 'ready' | 'missing' | 'downloading';
  purpose?: 'voice-correction';
}

export interface LocalModelDownloadProgressDto {
  modelId: string;
  file: string;
  fileIndex: number;
  fileCount: number;
  received: number;
  total: number | null;
  done?: true;
  error?: string;
}

// Keep the old persisted key's values for installations with a configured idle timeout.
const IDLE_MINUTES = [5, 10, 30, 0];
export const DEFAULT_MEMORY_MODEL_IDLE_MINUTES = 10;

export function normalizeMemoryModelIdleMinutes(value: unknown): number {
  return typeof value === 'number' && IDLE_MINUTES.includes(value)
    ? value
    : DEFAULT_MEMORY_MODEL_IDLE_MINUTES;
}
