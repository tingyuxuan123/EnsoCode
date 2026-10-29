// Self-contained: serialized into Runtime.evaluate; load is injectable for offline tests.
export async function sessionAction(win, input, load = (path) => import(path)) {
  const { command, id } = input;
  const fail = (error) => ({ ok: false, accepted: false, error, sessionId: id });
  try {
    const store = win.__stores?.sessions;
    const settings = win.__stores?.settings?.getState();
    if (!store || !settings || !win.electronAPI?.agent)
      return fail('NOT_READY: renderer stores/preload unavailable');
    if (command === 'session-new') {
      if (!settings.projects.some((p) => p.id === id)) return fail('UNKNOWN_PROJECT');
      const sessionId = await store.getState().newConversation(id);
      return sessionId ? { ok: true, accepted: true, sessionId } : fail('CREATE_REJECTED');
    }
    const conversation = store.getState().conversations[id];
    if (!conversation) return fail('UNKNOWN_SESSION: use a conversation ID, not a disk path');
    if (command === 'session-read') {
      const history = await (conversation.parentId
        ? win.electronAPI.agent.readChildHistory(id)
        : win.electronAPI.agent.readParentHistoryTail(id));
      return { ok: history.ok, sessionId: id, authority: 'main', history };
    }
    // One dev-only observer per renderer; it stores no text/keys and has no side effects.
    win.__ensoCdpTurns ??= { turns: {}, subscribed: false };
    const ledger = win.__ensoCdpTurns;
    if (!ledger.subscribed && win.electronAPI.agent.onEvent) {
      win.electronAPI.agent.onEvent((event) => {
        const turn = ledger.turns[event.identity?.sessionId];
        if (!turn) return;
        const current = store.getState().conversations[event.identity.sessionId];
        if (!current || (current.generation && current.generation !== event.identity.generation))
          return;
        if (
          turn.generation &&
          event.identity.generation &&
          turn.generation !== event.identity.generation
        ) {
          // 重建的 child generation 有自己的 seq 坐标系，旧事件不能完成新一轮。
          turn.afterSeq = 0;
          turn.running = false;
          delete turn.terminal;
        }
        turn.generation = event.identity.generation;
        if (event.type === 'status' && event.status === 'running') turn.running = true;
        if (event.type === 'turn-completed' && turn.running)
          turn.terminal = { seq: event.seq, error: event.requestBudgetError };
      });
      ledger.subscribed = true;
    }
    if (command === 'session-send') {
      if (typeof input.text !== 'string' || !input.text.trim()) return fail('EMPTY_TEXT');
      if (
        conversation.spawning ||
        conversation.status === 'running' ||
        conversation.queuedMessages?.length ||
        conversation.compaction ||
        conversation.workspaceMigrating ||
        conversation.rewinding ||
        conversation.restoringFiles
      )
        return fail('SESSION_BUSY');
      const project = settings.projects.find((p) => p.id === conversation.projectId);
      const cwd = conversation.worktree?.path ?? project?.path;
      if (typeof cwd !== 'string' || !cwd.trim() || !/^(\/|[A-Za-z]:[\\/])/.test(cwd))
        return fail('MISSING_CWD: project/worktree must provide an absolute working directory');
      const { readMaterializedProviders } = await load('/stores/modelDirectory/useProviders.ts');
      const { usableProvidersForOauthSnapshot, useOauthCredentialStore } = await load(
        '/stores/oauthCredentials/index.ts'
      );
      const providers = usableProvidersForOauthSnapshot(
        readMaterializedProviders(),
        useOauthCredentialStore.getState().snapshot
      );
      const group = settings.projectGroups?.find((g) => g.id === project?.groupId);
      const refs =
        input.providerId || input.modelId
          ? [{ providerId: input.providerId, modelId: input.modelId }]
          : [
              { providerId: conversation.lastProviderId, modelId: conversation.lastModelId },
              project?.defaultModel,
              group?.defaultModel,
              settings.defaultModel,
            ];
      const selection = refs.find(
        (ref) =>
          ref &&
          providers.some(
            (p) =>
              p.id === ref.providerId &&
              p.enabled &&
              p.models.some((m) => m.id === ref.modelId && m.enabled !== false)
          )
      );
      if (!selection)
        return fail(
          'MODEL_UNAVAILABLE: select an enabled, authenticated chat provider/model (virtual selections are not supported by this helper)'
        );
      const afterSeq = conversation.lastSeq ?? 0;
      ledger.turns[id] = {
        afterSeq,
        baselineGeneration: conversation.generation,
        generation: conversation.generation,
        running: conversation.status === 'running',
      };
      const error = await store
        .getState()
        .send(
          input.text,
          { providerId: selection.providerId, modelId: selection.modelId, cwd },
          undefined,
          id
        );
      if (error !== null) return fail(error || 'SEND_REJECTED');
      return {
        ok: true,
        accepted: true,
        sessionId: id,
        afterSeq,
        generation: conversation.generation,
        queued: conversation.started && conversation.status === 'running',
      };
    }
    if (command === 'session-state') {
      const previous = ledger.turns[id];
      const reset =
        previous?.baselineGeneration && previous.baselineGeneration !== conversation.generation;
      const afterSeq = reset
        ? 0
        : (input.afterSeq ?? previous?.afterSeq ?? conversation.lastSeq ?? 0);
      ledger.turns[id] ??= { afterSeq };
      const turn = ledger.turns[id];
      if (conversation.status === 'running') turn.running = true;
      const waiting = conversation.pendingApprovals?.length
        ? 'approval'
        : conversation.pendingCapabilityAsks?.length || conversation.activeOauthAsk
          ? 'capability-approval'
          : conversation.pendingAsks?.length
            ? 'user-answer'
            : conversation.planState?.pending
              ? 'plan-review'
              : undefined;
      const seq = conversation.lastSeq ?? 0;
      const progressed =
        seq > afterSeq || (turn.generation !== conversation.generation && seq > 0 && turn.running);
      const busy =
        conversation.spawning ||
        conversation.workspaceMigrating ||
        conversation.rewinding ||
        conversation.restoringFiles ||
        conversation.compaction ||
        conversation.queuedMessages?.length;
      const failed = conversation.status === 'failed';
      const stopped = conversation.abortRequested === true;
      const completed = turn.terminal && turn.terminal.seq > afterSeq;
      const complete = Boolean(
        !waiting &&
          !busy &&
          progressed &&
          (failed || (turn.running && (completed || stopped))) &&
          conversation.status !== 'running'
      );
      return {
        ok: true,
        sessionId: id,
        afterSeq,
        seq,
        generation: conversation.generation,
        status: conversation.status,
        error: conversation.error,
        waiting,
        progressed,
        complete,
        success: complete && !failed && !stopped && !turn.terminal?.error,
      };
    }
    return fail('UNKNOWN_SESSION_COMMAND');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
