import {
  completeWithin,
  parseRerankScores,
  parseSearchAnalysis,
  SEARCH_LLM_RERANK_MAX,
  SEARCH_LLM_TIMEOUT_MS,
  type SearchAssistReason,
  SearchLlmGate,
} from '@shared/memory/searchAssist';
import type { Complete } from './distill';
import type { SearchAssist } from './types';

const ANALYZE_SYSTEM =
  'Classify a memory-search query. Reply JSON only, no markdown: ' +
  '{"intent":"concept_lookup|factual_query|conceptual_question|relationship_query|exploratory_search",' +
  '"entity_terms":[],"confidence":0-1,' +
  '"has_temporal_intent":false,"temporal_type":null,"temporal_value":null,"temporal_confidence":0}. ' +
  'entity_terms: up to 3 substrings of the query, no translation. ' +
  'temporal_type is year|range|relative|context|reference when the query mentions time.';

const RERANK_SYSTEM =
  'Score each memory 0-10 for the query. Reply JSON only: {"scores":[...]} in the same order. No extra keys.';

const gate = new SearchLlmGate();

export function createSearchAssist(
  complete: Complete | null,
  opts?: { gate?: SearchLlmGate }
): SearchAssist | null {
  if (!complete) return null;
  const llmGate = opts?.gate ?? gate;
  const value = complete.searchTimeoutMs;
  const timeoutMs =
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : SEARCH_LLM_TIMEOUT_MS;
  let succeeded = false;
  let failure: SearchAssistReason | undefined;
  const fail = (reason: SearchAssistReason) => {
    failure ??= reason;
    if (reason === 'timeout' || reason === 'error') llmGate.trip();
  };
  const call = async (system: string, user: string, signal?: AbortSignal) => {
    const result = await completeWithin(
      (child) => complete(system, user, { signal: child }),
      timeoutMs,
      signal
    );
    if (!result.ok) {
      fail(result.reason);
      return null;
    }
    return result.value;
  };
  return {
    timeoutMs,
    fallback: fail,
    outcome: () =>
      succeeded
        ? { assist: 'llm' }
        : failure
          ? { assist: 'fallback', assistReason: failure }
          : { assist: 'off' },
    async analyze(query, signal) {
      if (!llmGate.available()) {
        fail('backoff');
        return null;
      }
      const raw = await call(ANALYZE_SYSTEM, query, signal);
      if (raw == null) return null;
      const parsed = parseSearchAnalysis(raw, query);
      if (parsed) succeeded = true;
      else fail('unparseable');
      return parsed;
    },
    async rerank(query, items, signal) {
      const window = items.slice(0, SEARCH_LLM_RERANK_MAX);
      if (window.length === 0) return null;
      if (!llmGate.available()) {
        fail('backoff');
        return null;
      }
      const listing = window
        .map((item, i) => `${i + 1}. ${item.title}\n${item.content}`)
        .join('\n\n');
      const raw = await call(RERANK_SYSTEM, `Query: ${query}\n\n${listing}`, signal);
      if (raw == null) return null;
      const parsed = parseRerankScores(raw, window.length);
      if (parsed) succeeded = true;
      else fail('unparseable');
      return parsed;
    },
  };
}
