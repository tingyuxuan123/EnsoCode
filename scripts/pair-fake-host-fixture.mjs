import { randomUUID } from 'node:crypto';

const SESSION_ID = '7a37cb67-b8b3-42f5-ad1a-8a134ff99f70';
const PROJECT = { id: 'fixture-project', name: 'Fake project', path: '/fixture' };
const LAUNCH_PROJECT = {
  id: 'launch-project',
  name: 'Second fixture',
  alias: 'Fixture workspace',
  path: '/fixture-2',
};
const PROVIDER = {
  id: 'fixture-provider',
  name: 'Fake provider',
  models: [{ id: 'fixture-model' }, { id: 'launch-model', label: 'Fixture launch model' }],
};
const TEXT_LIMIT = 4_096;
const REPLAY_LIMIT = 64;
const HISTORY_LIMIT = 64;
const TAIL_LENGTH = 12;

const textMessage = (role, text) => ({
  role,
  content: [{ type: 'text', text }],
  timestamp: Date.now(),
});

/** In-memory only, never reads paths, runs tools, or sends anything to a model. */
export function createFixture(send, isPairSyncCursor) {
  let sessionId = SESSION_ID;
  let identity = { sessionId, generation: randomUUID() };
  let epoch = randomUUID();
  let launch;
  const messages = [
    textMessage('user', 'Show me an offline demo.'),
    textMessage('assistant', 'This is an in-memory fixture.'),
  ];
  const events = [];
  let seq = 0;
  let baseIndex = 0;
  let subscribed = false;
  let withCursor = false;
  let startedDemo = false;
  let timer;
  let status = 'idle';
  let turn;
  let approval;
  let ask;
  let backgroundProbe = false;
  const queued = [];
  const hasText = (value) =>
    typeof value === 'string' && value.trim() && value.length <= TEXT_LIMIT;

  const cursor = () => ({ epoch, seq });
  function sendCatalog() {
    send({
      type: 'catalog',
      entries: [
        {
          id: sessionId,
          title: launch ? 'Fixture created task' : 'Fake host demo',
          projectName: launch ? LAUNCH_PROJECT.alias : PROJECT.name,
          projectId: launch?.projectId ?? PROJECT.id,
          providerId: PROVIDER.id,
          modelId: launch?.modelId ?? PROVIDER.models[0].id,
          status,
          updatedAt: messages.at(-1)?.timestamp,
          pendingApprovalCount: approval ? 1 : 0,
          pendingAskCount: ask ? 1 : 0,
          ...(subscribed && queued.length ? { queued } : {}),
        },
      ],
    });
  }

  function publish(payload) {
    const event = { ...payload, identity, sessionId, seq: ++seq };
    events.push(event);
    if (events.length > REPLAY_LIMIT) events.shift();
    if (subscribed)
      send({ type: 'agent-event', event, ...(withCursor ? { cursor: cursor() } : {}) });
  }

  function upsert(index, message) {
    messages[index - baseIndex] = message;
    if (messages.length > HISTORY_LIMIT) {
      messages.shift();
      baseIndex++;
    }
    publish({ type: 'message-upsert', index, message });
  }

  function schedule(fn) {
    timer = setTimeout(fn, 250);
  }

  function setStatus(next, error) {
    status = next;
    publish({ type: 'status', status, ...(error ? { error } : {}) });
    sendCatalog();
  }

  function finish(error, drain = true) {
    clearTimeout(timer);
    if (approval) publish({ type: 'approval-resolved', requestId: approval.requestId });
    if (ask) publish({ type: 'ask-resolved', requestId: ask.requestId });
    approval = undefined;
    ask = undefined;
    const turnId = turn.id;
    turn = undefined;
    publish(error ? { type: 'turn-failed', turnId, error } : { type: 'turn-completed', turnId });
    setStatus(error ? 'failed' : 'idle', error);
    if (!error && drain && queued.length) {
      schedule(() => {
        if (turn || !queued.length) return;
        const next = queued.shift();
        sendCatalog();
        start(next.text);
      });
    }
  }

  function start(text) {
    turn = { id: randomUUID(), assistantIndex: baseIndex + messages.length + 1 };
    setStatus('running');
    upsert(turn.assistantIndex - 1, textMessage('user', text));
    if (text === 'Hold notification fixture.') {
      backgroundProbe = true;
      return;
    }
    if (launch) {
      upsert(
        turn.assistantIndex,
        textMessage(
          'assistant',
          `Fixture running: ${launch.modelId} · ${launch.thinkingLevel} · ${launch.approvalMode}`
        )
      );
      return;
    }
    // Keep the turn active without approval so the device can exercise steer and abort deterministically.
    if (text === 'Hold this fixture turn.' || text === 'Hold queued fixture turn.') return;
    schedule(() => {
      upsert(turn.assistantIndex, textMessage('assistant', 'Preparing the'));
      schedule(() => {
        if (text === '/fail') return finish('Intentional fixture failure');
        const toolCallId = randomUUID();
        upsert(turn.assistantIndex, {
          ...textMessage('assistant', 'Preparing the fixture report.'),
          content: [
            { type: 'text', text: 'Preparing the fixture report.' },
            {
              type: 'toolCall',
              id: toolCallId,
              name: 'bash',
              arguments: { command: 'echo fixture' },
            },
          ],
        });
        approval = {
          requestId: randomUUID(),
          toolCallId,
          tool: 'bash',
          kind: 'command',
          summary: 'echo fixture (not executed)',
        };
        publish({ type: 'approval-request', request: approval });
        sendCatalog();
      });
    });
  }

  function snapshot() {
    const start = Math.max(0, messages.length - TAIL_LENGTH);
    return {
      type: 'snapshot',
      sessions: [
        {
          identity,
          sessionId,
          status,
          baseIndex: baseIndex + start,
          messages: messages.slice(start),
          commands: [],
          pendingApprovals: approval ? [approval] : [],
          pendingAsks: ask ? [ask] : [],
        },
      ],
    };
  }

  function subscribe(command) {
    if (command.sessionId === null) {
      subscribed = false;
      sendCatalog();
      return;
    }
    if (command.sessionId !== sessionId) return;
    const sync = command.sync;
    if (
      sync !== undefined &&
      (typeof sync?.requestId !== 'string' || !sync.requestId || sync.requestId.length > 512)
    )
      return;
    subscribed = true;
    withCursor = sync !== undefined;
    if (sync) {
      const envelope = {
        type: 'session-sync',
        sessionId,
        requestId: sync.requestId,
        cursor: cursor(),
      };
      const previous = sync.cursor;
      if (
        isPairSyncCursor(previous) &&
        previous.epoch === epoch &&
        previous.seq >= seq - events.length &&
        previous.seq <= seq
      ) {
        send({
          ...envelope,
          mode: 'replay',
          fromSeq: previous.seq,
          events: events.filter((event) => event.seq > previous.seq),
        });
      } else {
        send({ ...envelope, mode: 'snapshot', snapshot: snapshot() });
      }
    } else {
      send({ type: 'agent-event', event: snapshot() });
    }
    sendCatalog();
    if (!launch && !startedDemo && !turn) {
      startedDemo = true;
      start('Run the fixture report.');
    }
  }

  return {
    sendMeta() {
      send({ type: 'host-info', hostname: 'Enso fake host', appVersion: '0.0.0-fixture' });
      sendCatalog();
      send({ type: 'projects', projects: [PROJECT, LAUNCH_PROJECT] });
      send({ type: 'providers', providers: [PROVIDER] });
      send({ type: 'appearance', theme: 'system' });
    },
    clearSubscription() {
      subscribed = false;
    },
    stop() {
      clearTimeout(timer);
    },
    handle(command) {
      if (command.type === 'subscribe') return subscribe(command);
      if (command.type === 'presence' && command.visible === false && backgroundProbe && turn) {
        backgroundProbe = false;
        // Deterministic test-only request emitted after the guest reports it left the foreground.
        schedule(() => {
          if (!turn) return;
          approval = {
            requestId: randomUUID(),
            toolCallId: randomUUID(),
            tool: 'bash',
            kind: 'command',
            summary: 'echo background fixture (not executed)',
          };
          publish({ type: 'approval-request', request: approval });
          sendCatalog();
        });
        return;
      }
      if (command.type === 'probe' && Number.isFinite(command.nonce)) {
        send({ type: 'probe-ack', nonce: command.nonce });
      }
      // The loopback fixture supports a single replacement task, never launches a model or accesses disk.
      if (command.type === 'spawn') {
        if (
          launch ||
          turn ||
          typeof command.sessionId !== 'string' ||
          !/^[0-9a-f-]{36}$/.test(command.sessionId) ||
          command.sessionId === SESSION_ID ||
          command.projectId !== LAUNCH_PROJECT.id ||
          command.providerId !== PROVIDER.id ||
          command.modelId !== 'launch-model' ||
          command.approvalMode !== 'auto-edits' ||
          command.reasoningEnabled !== true ||
          command.thinkingLevel !== 'medium' ||
          ['cwd', 'apiKey', 'baseUrl', 'text', 'images', 'presetId'].some((key) => key in command)
        )
          return;
        launch = command;
        sessionId = command.sessionId;
        identity = { sessionId, generation: randomUUID() };
        epoch = randomUUID();
        events.length = messages.length = seq = baseIndex = 0;
        queued.length = 0;
        status = 'idle';
        subscribed = true; // Match pairHost's implicit selection before the phone's explicit sync.
        sendCatalog();
        return;
      }
      if (command.sessionId !== sessionId) return;
      switch (command.type) {
        case 'history': {
          if (!subscribed || !Number.isSafeInteger(command.beforeIndex) || command.beforeIndex < 0)
            return;
          const end = Math.min(
            baseIndex + messages.length,
            Math.max(baseIndex, command.beforeIndex)
          );
          const start = Math.max(baseIndex, end - TAIL_LENGTH);
          send({
            type: 'history',
            sessionId,
            baseIndex: start,
            messages: messages.slice(start - baseIndex, end - baseIndex),
          });
          break;
        }
        case 'prompt':
          if (
            !turn &&
            typeof command.text === 'string' &&
            command.text.trim() &&
            command.text.length <= TEXT_LIMIT
          )
            start(command.text);
          break;
        case 'abort':
          if (turn) finish('Fixture turn stopped');
          break;
        case 'steer':
          if (
            turn &&
            subscribed &&
            typeof command.text === 'string' &&
            command.text.trim() &&
            command.text.length <= TEXT_LIMIT
          ) {
            upsert(baseIndex + messages.length, textMessage('user', command.text));
          }
          break;
        case 'enqueue':
          if (turn && subscribed && queued.length < 64 && hasText(command.text)) {
            queued.push({ id: randomUUID(), text: command.text });
            sendCatalog();
          }
          break;
        case 'queue-update':
        case 'queue-remove':
        case 'queue-send-now':
        case 'queue-interrupt-send': {
          if (!subscribed) break;
          const index = queued.findIndex((item) => item.id === command.messageId);
          if (index < 0) break;
          if (command.type === 'queue-update') {
            if (!hasText(command.text)) break;
            queued[index] = { ...queued[index], text: command.text };
            sendCatalog();
            break;
          }
          if (command.type === 'queue-interrupt-send' && !turn) break;
          const [item] = queued.splice(index, 1);
          sendCatalog();
          if (command.type === 'queue-interrupt-send') {
            finish(undefined, false);
            start(item.text);
          } else if (command.type === 'queue-send-now') {
            if (turn) upsert(baseIndex + messages.length, textMessage('user', item.text));
            else start(item.text);
          }
          break;
        }
        case 'approval-respond': {
          if (
            !approval ||
            command.requestId !== approval.requestId ||
            !['allow', 'allowSession', 'deny'].includes(command.decision)
          )
            return;
          const { requestId, toolCallId, tool } = approval;
          publish({ type: 'approval-resolved', requestId });
          approval = undefined;
          if (command.decision === 'deny') return finish('Fixture approval denied');
          upsert(baseIndex + messages.length, {
            ...textMessage('toolResult', 'Simulated fixture output.'),
            toolCallId,
            toolName: tool,
          });
          ask = {
            requestId: randomUUID(),
            question: 'Which fixture report format?',
            options: ['Short', 'Detailed'],
            selectionOnly: true,
          };
          publish({ type: 'ask-request', ask });
          sendCatalog();
          break;
        }
        case 'ask-respond':
          if (
            !ask ||
            command.requestId !== ask.requestId ||
            (command.answer !== '' && !ask.options.includes(command.answer))
          )
            return;
          publish({ type: 'ask-resolved', requestId: ask.requestId });
          ask = undefined;
          if (!command.answer) return finish('Fixture question cancelled');
          upsert(
            baseIndex + messages.length,
            textMessage('assistant', `${command.answer} fixture report complete.`)
          );
          finish();
          break;
      }
    },
  };
}
