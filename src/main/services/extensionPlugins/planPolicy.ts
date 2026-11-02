import { type PlanState, planPhase } from '@shared/planMode';
import type { SessionIdentity } from '@shared/types/agent';

type PluginPlanEvent =
  | { type: 'plan-state'; identity: SessionIdentity; state: PlanState | undefined }
  | { type: 'parent-ready' | 'parent-ended' | 'parent-rejected'; identity: SessionIdentity }
  | { type: 'worker-exited'; identity?: SessionIdentity }
  | { type: 'snapshot'; sessions: readonly { identity: SessionIdentity; planState?: PlanState }[] };

/** Accepts unrelated worker events as well, so the actual event subscriber has one wiring point. */
export function observePluginPlanEvent(
  states: PluginPlanStates,
  event: PluginPlanEvent | { type: string }
): void {
  // Worker events are validated at agentHost; this projection only consumes the fields it needs.
  if (event.type === 'plan-state' && 'identity' in event && 'state' in event)
    states.set(event.identity, event.state);
  else if (event.type === 'parent-ready' && 'identity' in event) states.ready(event.identity);
  else if (event.type === 'snapshot' && 'sessions' in event) {
    states.clear();
    for (const session of event.sessions) states.set(session.identity, session.planState);
  } else if (
    event.type === 'parent-ended' ||
    event.type === 'parent-rejected' ||
    event.type === 'worker-exited'
  ) {
    if ('identity' in event && event.identity) states.remove(event.identity);
    else states.clear();
  }
}

/** Worker emits enabled Plan state before parent-ready on the same ordered channel. */
export class PluginPlanStates {
  private readonly states = new Map<string, { generation: string; restricting: boolean }>();
  set(identity: SessionIdentity, state: PlanState | undefined): void {
    const phase = planPhase(state);
    this.states.set(identity.sessionId, {
      generation: identity.generation,
      restricting: phase === 'planning' || phase === 'awaiting_review',
    });
  }
  ready(identity: SessionIdentity): void {
    if (this.states.get(identity.sessionId)?.generation !== identity.generation)
      this.set(identity, undefined);
  }
  allows(identity: SessionIdentity): boolean {
    const state = this.states.get(identity.sessionId);
    return state?.generation === identity.generation && !state.restricting;
  }
  remove(identity: SessionIdentity): void {
    if (this.states.get(identity.sessionId)?.generation === identity.generation)
      this.states.delete(identity.sessionId);
  }
  clear(): void {
    this.states.clear();
  }
}
