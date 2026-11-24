/** Dev-only visual fixtures: production build has index.html as its sole entry.
 * These are the real PWA components, not a second implementation of the design. */
import type { CatalogEntry, ProjectEntry, ProviderEntry } from '@enso/pair';
import { emptyGuestView } from '@shared/pair/guestProjection';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatScreen } from '../src/ChatScreen';
import { FileDownloadsRoot } from '../src/FileDownloads';
import { FileTransferPort } from '../src/fileTransferPort';
import { NewSessionSheet } from '../src/NewSessionSheet';
import { PairScreen } from '../src/PairScreen';
import { type SessionConfig, SessionConfigSheet } from '../src/SessionConfigSheet';
import { SessionDrawer } from '../src/SessionDrawer';
import { installElectronApiShim } from '../src/stubs/electron-api';
import { usePhoneScreenBack } from '../src/usePhoneScreenBack';
import '../src/styles.css';
import attachment from './attachment.json';

export { measurePhoneLayout } from './layout-probe';

installElectronApiShim();
const filesPort = new FileTransferPort(() => {});
const noop = () => {};
const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'sessions';
const regression = screen === 'regression';
document.documentElement.classList.toggle(
  'dark',
  screen === 'dark' || params.get('theme') === 'dark'
);
const now = Date.now();
const projects: ProjectEntry[] = ['EnsoCode', 'kdocs-bridge', 'image-studio'].map((name) => ({
  id: name,
  name,
  path: `/fixture/${name}`,
}));
const providers: ProviderEntry[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'sonnet', label: 'Sonnet 4.6' },
      { id: 'opus', label: 'Opus 4.6' },
    ],
  },
  { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt', label: 'gpt-6.1-sol' }] },
];
const catalog: CatalogEntry[] = [
  {
    id: 'main',
    projectId: 'EnsoCode',
    projectName: 'EnsoCode',
    title: '恢复会话后时间线为空',
    status: 'running',
    pinned: true,
    updatedAt: now - 180000,
  },
  {
    id: 'waiting',
    projectId: 'EnsoCode',
    projectName: 'EnsoCode',
    title: 'PWA 重设计：黑白 + 玻璃',
    status: 'idle',
    pendingApprovalCount: 1,
    updatedAt: now,
  },
  ...['补 pair 协议的回归测试', '会话导出 JSON 格式', '权限弹窗在窄屏被截'].map((title, i) => ({
    id: `session${i}`,
    projectId: 'EnsoCode',
    projectName: 'EnsoCode',
    title,
    status: 'idle',
    updatedAt: now - (i + 1) * 86400000,
  })),
  {
    id: 'failed',
    projectId: 'kdocs-bridge',
    projectName: 'kdocs-bridge',
    title: 'kdocs 插件签名校验失败',
    status: 'failed',
    updatedAt: now - 1080000,
  },
  {
    id: 'images',
    projectId: 'image-studio',
    projectName: 'image-studio',
    title: '广告素材批量导出',
    status: 'idle',
    updatedAt: now - 3600000,
  },
];
const view = emptyGuestView();
view.status = screen === 'running' ? 'running' : 'idle';
view.messages.set(0, {
  role: 'user',
  content: [
    {
      type: 'text',
      text: '恢复会话后时间线是空的，但 jsonl 里明明有记录。帮我查根因，修好并补测试。',
    },
  ],
  timestamp: now - 180000,
});
view.messages.set(1, {
  role: 'assistant',
  content: [
    {
      type: 'text',
      text: '根因在 renderer 的 reducer：恢复时 worker 从 `seq 1` 重新回放事件，而 store 里还留着旧连接的 `lastSeq = 412`，回放的事件全被当成过期丢掉了。\n\n修法是把重置放进回放的第一条事件，并把过期判定收窄到实时事件。补了两条测试：断开再恢复、回放中途换连接。',
    },
  ],
  timestamp: now - 120000,
});
if (regression) {
  view.status = 'running';
  view.tasks = [
    {
      taskId: 'server',
      command: 'pnpm --filter @enso/phone dev --host 127.0.0.1',
      status: 'running',
      tail: 'VITE ready\nhttp://127.0.0.1:5174',
      startedAt: now - 900000,
    },
  ];
  view.messages.clear();
  view.messages.set(0, {
    role: 'user',
    content: [
      { type: 'image', ...attachment },
      { type: 'text', text: '这个页面缺少返回啊 我一返回直接退出了' },
    ],
    timestamp: now - 180000,
  });
  view.messages.set(1, {
    role: 'assistant',
    model: 'gonshi/gpt-6.1-sol-long-provider-model-name',
    content: [
      { type: 'thinking', text: '沿完整呈现链路核对截图和共享组件。' },
      {
        type: 'text',
        text: '这是我把列表改成全屏时漏掉的导航。我会补返回入口，并检查系统返回为何直接退出。',
      },
      {
        type: 'toolCall',
        id: 'search',
        name: 'code_search',
        arguments: { query: 'Find PWA internal navigation' },
      },
    ],
    timestamp: now - 160000,
  });
  view.messages.set(2, {
    role: 'toolResult',
    toolCallId: 'search',
    toolName: 'code_search',
    isError: true,
    content: [{ type: 'text', text: 'Devin operation failed. No provider details were retained.' }],
    timestamp: now - 140000,
  });
  view.messages.set(3, {
    role: 'assistant',
    model: 'gonshi/gpt-6.1-sol-long-provider-model-name',
    content: [
      { type: 'text', text: '先复现这些排版问题，再对照设计稿修正，不把验证失败当作成功。' },
      { type: 'toolCall', id: 'check', name: 'bash', arguments: { command: 'git status --short' } },
    ],
    timestamp: now - 120000,
  });
}
if (screen === 'approval')
  view.approvals = [
    {
      requestId: 'a',
      tool: 'bash',
      kind: 'command',
      summary: 'pnpm test -- sessionReducer',
      expiresAt: now + 42000,
    },
  ];
if (screen === 'ask')
  view.asks = [
    {
      requestId: 'q',
      question: '修复方式你更倾向哪一种？',
      options: ['只修恢复链路，先别动存储格式', '顺便统一事件的 seq 规则'],
      expiresAt: now + 292000,
    },
  ];

function Preview() {
  const navigation = usePhoneScreenBack({
    enabled: screen === 'navigation',
    docked: false,
    initialListOpen: screen === 'sessions' || screen === 'settings',
  });
  const drawer = navigation.drawerOpen;
  const setDrawer = (open: boolean) => (open ? navigation.openDrawer() : navigation.closeDrawer());
  const [config, setConfig] = useState(screen === 'config');
  const [creating, setCreating] = useState(screen === 'new-session');
  const [sessionConfig, setSessionConfig] = useState<SessionConfig>({
    providerId: 'anthropic',
    modelId: 'sonnet',
    reasoningEnabled: true,
    thinkingLevel: 'high' as const,
  });
  return (
    <FileDownloadsRoot port={filesPort} available online>
      <div className="flex h-full min-h-0 flex-1 bg-page text-ink">
        {screen === 'pair' ? (
          <PairScreen onPaired={noop} />
        ) : (
          <>
            <SessionDrawer
              open={drawer}
              backToConversation={
                screen === 'navigation' ? navigation.backToConversation : undefined
              }
              projects={projects}
              catalog={catalog}
              activeId="main"
              canCreate
              devices={[
                {
                  pairId: 'fixture',
                  token: 'fixture',
                  contentKey: 'fixture',
                  relayUrl: 'https://relay.yfdl.site',
                  deviceName: 'iPhone',
                  label: '书房',
                  pairedAt: now,
                },
              ]}
              activeDevicePairId="fixture"
              connected
              connectionLabel="书房 · 已连接"
              pushEnabled
              pushBusy={false}
              pushError={null}
              pushAvailability="ok"
              pushConfigReady
              onTogglePush={noop}
              onClose={() => setDrawer(false)}
              onSelect={() => setDrawer(false)}
              onNewConversation={() => {
                setDrawer(false);
                setCreating(true);
              }}
              onSwitchDevice={noop}
              onAddDevice={noop}
              onRenameDevice={noop}
              onUnpairDevice={noop}
            />
            <div inert={drawer} aria-hidden={drawer} className="h-full min-w-0 flex-1">
              <ChatScreen
                sessionId="main"
                title={regression ? 'PWA 界面设计稿还原重构' : catalog[0].title}
                projectName="EnsoCode"
                modelLabel={regression ? 'GPT-6.1 Sol' : 'Sonnet 4.6 · 思考 高'}
                view={view}
                connState="online"
                stateLabel="已连接"
                canCreate
                onOpenDrawer={() => setDrawer(true)}
                onNewSession={() => setCreating(true)}
                onOpenConfig={() => setConfig(true)}
                onSend={noop}
                onAbort={noop}
                onApproval={noop}
                onAsk={noop}
                deviceReadOnly={screen === 'readonly-device'}
                tabGroup={{
                  parent: catalog[0],
                  children: [{ ...catalog[0], id: 'dev', title: '阿全' }],
                }}
                onSelectTab={noop}
                usageTotals={{
                  inputTokens: 10000,
                  outputTokens: 2400,
                  cacheHitPercent: 92,
                  tokensPerSecond: 42,
                }}
                context={{ used: 38000, window: 100000 }}
              />
            </div>
            <NewSessionSheet
              open={creating}
              projects={projects}
              providers={providers}
              connectionLabel="书房 · 已连接"
              recentSessions={catalog.slice(0, 2)}
              onClose={() => setCreating(false)}
              onCreate={() => setCreating(false)}
            />
            <SessionConfigSheet
              open={config}
              providers={providers}
              config={sessionConfig}
              onClose={() => setConfig(false)}
              onSetModel={(providerId, modelId) =>
                setSessionConfig((old) => ({ ...old, providerId, modelId }))
              }
              onSetReasoning={(reasoningEnabled) =>
                setSessionConfig((old) => ({ ...old, reasoningEnabled }))
              }
              onSetThinking={(thinkingLevel) =>
                setSessionConfig((old) => ({ ...old, thinkingLevel }))
              }
            />
          </>
        )}
      </div>
    </FileDownloadsRoot>
  );
}

if (import.meta.env.DEV) {
  const root = document.getElementById('root');
  if (root) createRoot(root).render(<Preview />);
}
