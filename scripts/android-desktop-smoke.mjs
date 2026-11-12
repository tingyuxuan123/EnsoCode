/** Emulator -> real isolated Electron/Main/worker -> local deterministic model. No real credentials. */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  connect,
  fetchJson,
  selectPage,
  waitUntil,
} from '../.agents/skills/enso-cdp/scripts/cdp-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('ANDROID_HOME must identify the local Android SDK');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const serial = process.env.EAVES_TEST_EMULATOR ?? 'emulator-5554';
const pkg = 'io.github.tingyuxuan123.eaves';
const runner = `${pkg}.test/androidx.test.runner.AndroidJUnitRunner`;
const output = path.join(root, 'temp/eaves-real-desktop');
const botMode = process.env.EAVES_DESKTOP_BOT_SMOKE === '1';
const threadMode = botMode && process.env.EAVES_DESKTOP_BOT_THREADS_SMOKE === '1';
const memberMode = botMode && process.env.EAVES_DESKTOP_BOT_MEMBERS_SMOKE === '1';
// macOS aliases /var to /private/var; the worker records the canonical cwd.
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'eaves-real-desktop-')));
const profile = path.join(temporary, 'profile');
const project = path.join(temporary, 'selected-project');
const children = [];
let rpc;
let expectedId;
let reversed;
let cdpPort;
let botConnectivityProbes = 0;

function command(binary, args, timeout = 20_000) {
  const result = spawnSync(binary, args, {
    cwd: root,
    timeout,
    maxBuffer: 12 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`Fixture command failed: ${path.basename(binary)} (details withheld)`);
  return result.stdout;
}
const android = (...args) => command(adb, ['-s', serial, ...args]);

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function start(binary, args, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, args, {
    cwd: root,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    // electron-vite spawns Electron. On POSIX the whole fixture needs its own process group;
    // killing only the wrapper leaves Electron holding the inherited pipes and stalls cleanup.
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  children.push(child);
  let text = '';
  const log = createWriteStream(path.join(temporary, `process-${children.length}.log`));
  child.stdout.on('data', (data) => {
    if (text.length < 512_000) text += data;
    log.write(data);
  });
  child.stderr.on('data', (data) => {
    if (text.length < 512_000) text += data;
    log.write(data);
  });
  child.once('close', () => log.end());
  return { child, read: () => text };
}

function instrument(method, extras, testClass = 'RealDesktopLoopbackTest') {
  const args = [
    'shell',
    'am',
    'instrument',
    '-w',
    '-r',
    '-e',
    'class',
    `${pkg}.${testClass}#${method}`,
  ];
  for (const [key, value] of Object.entries(extras)) args.push('-e', key, value);
  const result = command(adb, ['-s', serial, ...args, runner], 150_000).toString('utf8');
  if (!/OK \(1 test\)/.test(result) || /FAILURES!!!|INSTRUMENTATION_FAILED/.test(result)) {
    const encoded = extras.eavesDesktopInviteB64;
    const detail = encoded
      ? result
          .replaceAll(encoded, '<invite>')
          .replaceAll(Buffer.from(encoded, 'base64url').toString(), '<invite>')
      : result;
    throw new Error(`Real desktop instrumentation failed (${method}): ${detail.slice(-6000)}`);
  }
}

async function evaluate(expression) {
  const response = await rpc.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.result?.exceptionDetails) throw new Error('Isolated renderer evaluation failed');
  return response.result?.result?.value;
}

async function assertOwnedBrowser(port, ancestor) {
  const version = await fetchJson(port, '/json/version');
  const browser = await connect(version.webSocketDebuggerUrl, { expectedPort: port });
  let pid;
  try {
    pid = (await browser.send('SystemInfo.getProcessInfo')).result.processInfo.find(
      (p) => p.type === 'browser'
    )?.id;
  } finally {
    browser.close();
  }
  if (!Number.isSafeInteger(pid)) throw new Error('Could not identify the isolated browser');
  for (let depth = 0; depth < 8; depth++) {
    if (pid === ancestor) return;
    if (process.platform === 'win32') {
      pid = Number(
        command('powershell.exe', [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId`,
        ])
          .toString()
          .trim()
      );
    } else {
      pid = Number(
        command('ps', ['-o', 'ppid=', '-p', String(pid)])
          .toString()
          .trim()
      );
    }
    if (!Number.isSafeInteger(pid) || pid <= 1) break;
  }
  throw new Error('Refusing CDP writes: endpoint is not owned by this fixture');
}

try {
  if (android('shell', 'getprop', 'ro.kernel.qemu').toString().trim() !== '1')
    throw new Error('Emulator required');
  const guard = spawnSync(
    adb,
    ['-s', serial, 'shell', 'run-as', pkg, 'ls', 'no_backup/pair_credentials.bin'],
    { timeout: 5000 }
  );
  if (guard.status === 0) throw new Error('Refusing to replace an existing App pairing');
  await mkdir(output, { recursive: true });
  await mkdir(profile, { recursive: true });
  await mkdir(project, { recursive: true });
  const otherProject = path.join(temporary, 'default-project');
  await mkdir(otherProject, { recursive: true });
  await writeFile(path.join(project, 'README.md'), 'Disposable Android desktop smoke project.\n');
  const modelPort = await freePort();
  cdpPort = await freePort();
  if (cdpPort === 9222) throw new Error('Default CDP port is forbidden');
  const providers = ['A', 'B'].map((letter) => ({
    id: `loopback-${letter}`,
    name: `Loopback ${letter}`,
    api: 'anthropic-messages',
    enabled: true,
    apiKey: `sk-fake-${letter}`,
    baseUrl: `http://127.0.0.1:${modelPort}`,
    models: [
      {
        id: letter === 'A' ? 'fake-model-1' : 'fake-model-2',
        label: letter === 'A' ? 'Local default model' : 'Local selected model',
        reasoning: letter === 'B' ? 'on' : 'off',
        vision: true,
      },
    ],
  }));
  await writeFile(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      'enso-settings': {
        state: {
          providers,
          defaultModel: { providerId: 'loopback-A', modelId: 'fake-model-1' },
          onboarded: true,
          theme: 'light',
          language: 'zh-CN',
          titleSummaryEnabled: false,
          ...(botMode ? { botModeEnabled: true } : {}),
        },
        version: 2,
      },
    })
  );
  const model = start(process.execPath, ['scripts/fake-provider-issue-27.mjs'], {
    FAKE_PROVIDER_PORT: String(modelPort),
    FAKE_PROVIDER_HOLD_TEXT: 'Android queue hold first turn.',
    FAKE_PROVIDER_HOLD_MS: '25000',
  });
  await waitUntil(() => model.read().includes('[fake-provider] listening'), {
    timeout: 10_000,
    interval: 100,
  });
  const relayBinary = path.join(temporary, process.platform === 'win32' ? 'relay.exe' : 'relay');
  const built = spawnSync('go', ['build', '-o', relayBinary, '.'], {
    cwd: path.join(root, 'packages/relay-go'),
    timeout: 180_000,
    windowsHide: true,
  });
  if (built.status !== 0) throw new Error('Could not build disposable relay');
  const relay = start(relayBinary, [
    '-listen',
    '127.0.0.1:0',
    '-db',
    path.join(temporary, 'relay.sqlite'),
    '-auto-update=false',
  ]);
  let origin;
  await waitUntil(
    () => {
      origin = /http:\/\/127\.0\.0\.1:\d+/.exec(relay.read())?.[0];
      return origin;
    },
    { timeout: 15_000, interval: 100 }
  );
  const relayPort = new URL(origin).port;
  android('reverse', '--no-rebind', `tcp:${relayPort}`, `tcp:${relayPort}`);
  reversed = relayPort;
  android('install', '-r', path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'));
  android(
    'install',
    '-r',
    path.join(root, 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')
  );
  const desktop = start(
    process.execPath,
    ['node_modules/electron-vite/bin/electron-vite.js', 'dev'],
    {
      ENSO_USER_DATA_DIR: profile,
      ENSO_CDP_PORT: String(cdpPort),
      PI_CODING_AGENT_DIR: path.join(profile, 'agent', 'pi-agent'),
    }
  );
  let target;
  await waitUntil(
    async () => {
      if (desktop.child.exitCode !== null)
        throw new Error(`Isolated desktop exited: ${desktop.read().slice(-6000)}`);
      try {
        target = selectPage(
          await fetchJson(cdpPort, '/json/list', { timeout: 1000 }),
          'index.html'
        );
        return Boolean(target);
      } catch {
        return false;
      }
    },
    { timeout: 90_000, interval: 250 }
  );
  await assertOwnedBrowser(cdpPort, desktop.child.pid);
  rpc = await connect(target.webSocketDebuggerUrl, { expectedPort: cdpPort, timeout: 15_000 });
  await waitUntil(
    () => evaluate('Boolean(window.__stores?.settings && window.electronAPI?.pair)'),
    { timeout: 20_000, interval: 100 }
  );
  const projects = await evaluate(
    `(async()=>{const s=window.__stores.settings.getState(); const a=await s.addProject(${JSON.stringify(otherProject)}); const b=await s.addProject(${JSON.stringify(project)}); return [a.id,b.id]})()`
  );
  await evaluate(`window.electronAPI.pair.setRelayUrl(${JSON.stringify(origin)})`);
  const inviteResult = await evaluate('window.electronAPI.pair.start()');
  if (!inviteResult?.ok || typeof inviteResult.inviteUri !== 'string')
    throw new Error('Desktop pairing failed');
  const invite = inviteResult.inviteUri;
  const uri = new URL(invite);
  const params = new URLSearchParams(uri.hash ? uri.hash.slice(1) : uri.search.slice(1));
  if ((params.get('relay') ?? uri.origin) !== origin || !params.get('pk')) {
    throw new Error('Desktop invite does not belong to the disposable relay');
  }
  expectedId = createHash('sha256')
    .update(params.get('pk'))
    .digest()
    .subarray(0, 16)
    .toString('base64url');
  instrument('pairCreateAndReceive', {
    eavesDesktopInviteB64: Buffer.from(invite).toString('base64url'),
  });
  const inspect = async () =>
    evaluate(
      `(async()=>{const list=Object.values(window.__stores.sessions.getState().conversations).filter(c=>c.projectId===${JSON.stringify(projects[1])}); if(list.length!==1) return {count:list.length}; const c=list[0]; const h=await window.electronAPI.agent.readParentHistoryTail(c.id); return {count:1,id:c.id,projectId:c.projectId,providerId:c.lastProviderId,modelId:c.lastModelId,approvalMode:c.approvalMode,thinkingLevel:c.thinkingLevel,reasoningEnabled:c.reasoningEnabled,status:c.status,history:h}})()`
    );
  const evidence = await inspect();
  if (
    evidence.count !== 1 ||
    evidence.providerId !== 'loopback-B' ||
    evidence.modelId !== 'fake-model-2' ||
    evidence.approvalMode !== 'auto-edits' ||
    evidence.thinkingLevel !== 'medium' ||
    evidence.reasoningEnabled !== true
  ) {
    throw new Error('Actual desktop configuration did not match Android selection');
  }
  const endpoint = async () =>
    (
      await fetch(`http://127.0.0.1:${modelPort}/__requests`, { signal: AbortSignal.timeout(5000) })
    ).json();
  const requests = await endpoint();
  if (
    requests.count !== 1 ||
    requests.requests[0]?.model !== 'fake-model-2' ||
    requests.requests[0]?.authKey !== 'fake-B'
  ) {
    throw new Error(
      'Worker did not dispatch exactly once through the selected local provider/model'
    );
  }
  android('shell', 'am', 'force-stop', pkg);
  try {
    instrument('restoreAndOpen', {
      eavesDesktopExpectedId: expectedId,
      eavesDesktopTaskId: evidence.id,
    });
  } catch (error) {
    console.error(
      'Isolated host state:',
      await evaluate(
        `(async()=>{const p=await window.electronAPI.pair.status();return {devices:p.devices,conversations:Object.values(window.__stores.sessions.getState().conversations).map(c=>({id:c.id,title:c.title,projectId:c.projectId,status:c.status}))}})()`
      )
    );
    await writeFile(
      path.join(output, 'restore-failure.png'),
      android('exec-out', 'run-as', pkg, 'cat', 'cache/desktop-restore-failure.png')
    );
    throw error;
  }
  const afterRestore = (await endpoint()).count;
  if (afterRestore !== 1) throw new Error('Process restore duplicated a model request');
  instrument('verifyQueueDrainsAfterCurrentTurn', {
    eavesDesktopExpectedId: expectedId,
    eavesDesktopTaskId: evidence.id,
    eavesDesktopQueue: '1',
  });
  await waitUntil(async () => (await inspect()).status === 'idle', {
    timeout: 10_000,
    interval: 100,
  });
  const afterQueue = await inspect();
  const queueUsers = afterQueue.history?.ok
    ? afterQueue.history.messages.filter((message) => message.role === 'user')
    : [];
  if (
    queueUsers.filter((message) =>
      JSON.stringify(message.content).includes('Android queue smoke delivered.')
    ).length !== 1 ||
    queueUsers.some((message) =>
      JSON.stringify(message.content).includes('Android queue smoke original.')
    ) ||
    (await endpoint()).count !== 3
  ) {
    throw new Error('Queue did not drain exactly once with the edited message');
  }
  const imageMode = process.env.EAVES_DESKTOP_IMAGE_SMOKE === '1';
  if (imageMode) {
    instrument('verifyImagePickedAndSent', {
      eavesDesktopExpectedId: expectedId,
      eavesDesktopTaskId: evidence.id,
      eavesDesktopImage: '1',
    });
    const proof = JSON.parse(
      android('exec-out', 'run-as', pkg, 'cat', 'cache/desktop-image-proof.json').toString('utf8')
    );
    let imageRequests;
    await waitUntil(
      async () => {
        imageRequests = (await endpoint()).requests
          .slice(3)
          .filter((request) => request.lastUserImages?.length);
        return imageRequests.length > 0 && (await inspect()).status === 'idle';
      },
      { timeout: 20_000, interval: 200 }
    );
    const received = imageRequests[0].lastUserImages;
    if (
      imageRequests.length !== 1 ||
      received.length !== 1 ||
      received[0].mimeType !== 'image/jpeg' ||
      proof.mimeType !== received[0].mimeType ||
      !/^[0-9a-f]{64}$/.test(proof.sha256) ||
      proof.sha256 !== received[0].sha256
    ) {
      throw new Error('Worker did not dispatch the exact picked image bytes once');
    }
  }
  const goalMode = process.env.EAVES_DESKTOP_GOAL_SMOKE === '1';
  if (goalMode) {
    const beforeGoal = (await endpoint()).count;
    instrument('verifyGoalLifecycle', {
      eavesDesktopExpectedId: expectedId,
      eavesDesktopTaskId: evidence.id,
      eavesDesktopGoal: '1',
    });
    const afterGoal = await inspect();
    const goalTurns = afterGoal.history?.ok
      ? afterGoal.history.messages.filter(
          (message) =>
            message.role === 'user' &&
            JSON.stringify(message.content).includes('Verify the goal lifecycle.')
        )
      : [];
    if (
      (await endpoint()).count !== beforeGoal + 2 ||
      afterGoal.status !== 'idle' ||
      goalTurns.length !== 2 ||
      !JSON.stringify(goalTurns[1].content).includes('Session goal resumed:')
    ) {
      throw new Error(
        'Goal did not kick off and resume exactly once each in authoritative history'
      );
    }
  }
  if (botMode) {
    const chat = await evaluate(`(async()=>{
      const api=window.electronAPI.bots;
      const draft={title:'Loopback',tools:'readonly',memory:{enabled:false},engine:{providerId:'loopback-A',modelId:'fake-model-1'}};
      const member=await api.create({...draft,name:'FixtureLead'});
      if(!member.ok) return member;
      const peer=await api.create({...draft,name:'FixturePeer'});
      if(!peer.ok) return peer;
      return api.createChat({kind:'group',title:'Android Bot smoke group',members:[member.bot.id,peer.bot.id],bossBotId:member.bot.id,workspace:{kind:'chat-home'},routing:{mode:'boss'}});
    })()`);
    if (!chat?.ok || !/^[a-z0-9-]+$/i.test(chat.chat?.id ?? '')) {
      throw new Error(
        `Failed to create disposable Bot group: ${chat?.error ?? 'invalid identity'}`
      );
    }
    const chatId = chat.chat.id;
    const beforeBot = (await endpoint()).count;
    instrument('verifyBotSendAndStop', {
      eavesDesktopExpectedId: expectedId,
      eavesDesktopBotChat: chatId,
      ...(threadMode ? { eavesDesktopBotThreads: '1' } : {}),
    });
    if (threadMode) {
      const snapshot = await evaluate('window.electronAPI.bots.chats()');
      const rootChat = snapshot?.chats?.find((row) => row.id === chatId);
      const topics = snapshot?.chats?.filter((row) => row.parentId === chatId);
      if (!snapshot?.ok || !rootChat || rootChat.activeThreadId || topics?.length !== 1) {
        throw new Error('Desktop did not retain one new topic and switch back to the root');
      }
    }
    const timeline = await evaluate(
      `window.electronAPI.bots.timeline({chatId:${JSON.stringify(chatId)},limit:20})`
    );
    const botRequests = (await endpoint()).requests.slice(beforeBot);
    // A new Bot worker first probes its provider with a no-tools "ping" before normal dispatch.
    const workerRequests = botRequests.filter((request) => request.toolNames?.length > 0);
    botConnectivityProbes = botRequests.filter(
      (request) => !request.toolNames?.length && request.lastUserText === 'ping'
    ).length;
    const firstMessages = timeline?.ok
      ? timeline.entries.filter(
          (entry) => entry.kind === 'human' && entry.text === 'Android Bot smoke first message.'
        )
      : [];
    if (
      firstMessages.length !== 1 ||
      !timeline.entries.some((entry) => entry.kind === 'bot' && entry.text === 'fake-ok') ||
      workerRequests.length !== 2 ||
      workerRequests.length + botConnectivityProbes !== botRequests.length
    ) {
      throw new Error(
        `Bot fixture mismatch: human=${firstMessages.length}, bot=${timeline.entries?.filter((entry) => entry.kind === 'bot').length}, workerRequests=${workerRequests.length}, probes=${botConnectivityProbes}`
      );
    }
    if (memberMode) {
      instrument('verifyMemberCreationAndDirectHistory', {
        eavesDesktopExpectedId: expectedId,
        eavesDesktopBotMembers: '1',
      });
      const snapshot = await evaluate('window.electronAPI.bots.chats()');
      const direct = snapshot?.chats?.filter((row) => row.kind === 'direct');
      const created = snapshot?.chats?.filter(
        (row) => row.title === 'Android created member group'
      );
      if (
        !snapshot?.ok ||
        direct?.length !== 1 ||
        Object.keys(direct[0].sessions).length !== 1 ||
        created?.length !== 1 ||
        created[0].members.length !== 2 ||
        created[0].bossBotId !== direct[0].members[0]
      ) {
        throw new Error(
          'Desktop did not persist the same direct session and exactly one two-member group'
        );
      }
    }
  }
  const modelMode = process.env.EAVES_DESKTOP_MODEL_SMOKE === '1';
  const shellTool = ['powershell', 'bash'].find((name) =>
    requests.requests[0]?.toolNames?.includes(name)
  );
  if (!shellTool) throw new Error('No supported command tool advertised by the worker');
  instrument('verifyApprovalAndUnpair', {
    eavesDesktopExpectedId: expectedId,
    eavesDesktopTaskId: evidence.id,
    eavesDesktopTool: shellTool,
    ...(modelMode ? { eavesDesktopModel: '1' } : {}),
  });
  const afterApproval = await inspect();
  if (
    !afterApproval.history?.ok ||
    !afterApproval.history.messages.some(
      (message) =>
        message.role === 'toolResult' &&
        message.toolName === shellTool &&
        message.isError === true &&
        JSON.stringify(message.content).includes('User denied this operation')
    )
  ) {
    throw new Error('Main authoritative history did not confirm command denial');
  }
  if (modelMode) {
    await waitUntil(async () => (await inspect()).status === 'idle', {
      timeout: 15_000,
      interval: 100,
    });
    const beforeSwitch = (await endpoint()).count;
    instrument('verifySessionModelSwitch', {
      eavesDesktopExpectedId: expectedId,
      eavesDesktopTaskId: evidence.id,
      eavesDesktopModel: '1',
    });
    const switched = await inspect();
    const dispatched = (await endpoint()).requests.slice(beforeSwitch);
    if (
      switched.providerId !== 'loopback-A' ||
      switched.modelId !== 'fake-model-1' ||
      dispatched.length !== 1 ||
      dispatched[0].model !== 'fake-model-1' ||
      dispatched[0].authKey !== 'fake-A'
    ) {
      throw new Error(
        'Existing session did not dispatch its next turn through the newly selected model'
      );
    }
  }
  for (const name of [
    'desktop-config.png',
    'desktop-timeline.png',
    'desktop-restored.png',
    'desktop-approval.png',
    'desktop-queue.png',
    ...(memberMode ? ['desktop-member-direct.png', 'desktop-member-created-group.png'] : []),
    ...(modelMode ? ['desktop-session-model.png', 'desktop-session-thinking.png'] : []),
    ...(imageMode ? ['desktop-image-draft.png', 'desktop-image-sent.png'] : []),
    ...(goalMode
      ? ['desktop-goal-set.png', 'desktop-goal-active.png', 'desktop-goal-paused.png']
      : []),
  ]) {
    await writeFile(
      path.join(output, name),
      android('exec-out', 'run-as', pkg, 'cat', `cache/${name}`)
    );
  }
  // Record only fixture facts; no credentials, provider request bodies or raw session history.
  const sessionFiles = await readdir(path.join(profile, 'agent', 'sessions'), { recursive: true });
  const records = [];
  for (const file of sessionFiles.filter((name) => name.endsWith('.jsonl'))) {
    for (const line of (await readFile(path.join(profile, 'agent', 'sessions', file), 'utf8'))
      .split('\n')
      .filter(Boolean)) {
      try {
        records.push(JSON.parse(line));
      } catch {
        /* Ignore a partial final append. */
      }
    }
  }
  if (
    !records.some(
      (r) =>
        r.type === 'session' &&
        typeof r.cwd === 'string' &&
        path.resolve(r.cwd) === path.resolve(project)
    )
  )
    throw new Error('Worker session cwd did not match selected project');
  if (!records.some((r) => r.type === 'thinking_level_change' && r.thinkingLevel === 'medium')) {
    throw new Error('Worker journal did not apply the selected thinking level');
  }
  if (
    modelMode &&
    !records.some((r) => r.type === 'thinking_level_change' && r.thinkingLevel === 'high')
  ) {
    throw new Error('Worker journal did not apply the existing session’s new thinking level');
  }
  const messages = evidence.history?.ok ? evidence.history.messages : [];
  const initialUsers = messages.filter(
    (message) =>
      message.role === 'user' &&
      JSON.stringify(message.content).includes('Android desktop smoke first turn.')
  );
  if (
    initialUsers.length !== 1 ||
    !messages.some(
      (message) =>
        message.role === 'assistant' && JSON.stringify(message.content).includes('fake-ok')
    )
  )
    throw new Error('Main authoritative history is missing the turn');
  await writeFile(
    path.join(output, 'evidence.json'),
    JSON.stringify(
      {
        desktop: 'real Electron/Main/worker',
        model: 'local deterministic Anthropic-compatible fixture (not a real vendor)',
        projectMatchesWorkerCwd: true,
        workerJournalThinkingLevel: 'medium',
        ...Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== 'history')),
        modelRequestsBeforeAndAfterRestore: [requests.count, afterRestore],
        authoritativeHistoryContainsTurn: true,
        commandApprovalShownAndDenied: true,
        commandDenialConfirmedByMainHistory: true,
        queueEditAndAutomaticDrainConfirmedByMainHistory: true,
        ...(modelMode
          ? {
              sessionModelSwitchConfirmedByCatalogAndWorker: true,
              sessionThinkingChangeConfirmedByCatalogAndWorker: true,
            }
          : {}),
        ...(imageMode ? { androidPhotoPickerImageMatchedWorkerDispatch: true } : {}),
        ...(goalMode
          ? { goalSetPauseResumeClearConfirmed: true, goalKickoffAndResumeRequests: 2 }
          : {}),
        ...(botMode
          ? { botSendAndStopConfirmed: true, botWorkerRequests: 2, botConnectivityProbes }
          : {}),
        ...(threadMode ? { botThreadCreatedAndRootRestored: true } : {}),
        ...(memberMode
          ? { botDirectOpenedSentAndResubscribed: true, botGroupCreatedFromAndroid: true }
          : {}),
      },
      null,
      2
    )
  );
  console.log(
    'Real Electron/Main/worker: Android task config, first reply, durable restore, command denial and unpair verified.'
  );
  console.log(`Evidence: ${output}`);
} finally {
  let clean = true;
  if (expectedId) {
    try {
      instrument('cleanupLoopbackFixture', { eavesPairCleanup: expectedId }, 'PairingLoopbackTest');
    } catch {
      clean = false;
      console.error('App fixture cleanup needs attention.');
    }
    if (rpc) {
      try {
        await evaluate(`window.electronAPI.pair.revoke(${JSON.stringify(expectedId)})`);
      } catch {
        /* Profile is disposable. */
      }
    }
  }
  rpc?.close();
  if (reversed) {
    try {
      android('reverse', '--remove', `tcp:${reversed}`);
    } catch {
      clean = false;
    }
  }
  for (const child of children.reverse()) {
    if (!child.pid) continue;
    if (process.platform === 'win32') {
      if (child.exitCode === null)
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          timeout: 10_000,
        });
    } else {
      try {
        // Disposable-only group, just like Windows /T /F. Electron can intercept SIGTERM.
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') clean = false;
      }
    }
  }
  try {
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    clean = false;
    console.error('Disposable desktop profile cleanup needs attention.');
  }
  if (!clean) process.exitCode = 1;
}
