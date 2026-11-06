import { resolveChatModel, scopedDefaultModels } from '@shared/defaultModel';
import { addSidePanelDesign, setSidePanelDesignVisible } from '@/lib/sidePanelDock';
import { isBotModeActive, showLocalCodeView } from '@/stores/bots/mode';
import { readMaterializedProviders } from '@/stores/modelDirectory/useProviders';
import { oauthCredentialContext, useOauthCredentialStore } from '@/stores/oauthCredentials';
import { useSessionsStore } from '@/stores/sessions';
import { sessionWorkspaceCwd } from '@/stores/sessions/workspaceCwd';
import { useSettingsStore } from '@/stores/settings';
import { useSidePanelStore } from '@/stores/sidePanel';
import type { SendPromptResult } from '../vetta/sdk/conversation';
import { CANVAS_TAB_ID, GALLERY_VIEW_ID } from '../vetta/src/tab-ids';
import {
  resolveDesignActivitySession,
  resolveDesignPromptTarget,
  viewedDesignSessionId,
} from './activity-route';
import { isDesignViewingCwd } from './canvas-target';
import { insertDesignComposerText, setDesignPromptAttachment } from './composer';
import { currentDesignConversation, type DesignContextHost } from './context';
import { resolveDesignRoot } from './paths';
import { updateDesignUi, useDesignRegistry } from './registry';
import { translate } from './translation';
import { closeDesignGallery, openDesignGallery } from './workspace-view';

/*
 * 主窗口宿主：会话选择、侧栏 Dock、Composer、画廊导航都依赖主窗口独有的
 * sessions / sidePanel store。独立设计窗口绝不能导入本文件——那些 store 会从
 * settings.json 水合并把旧快照写回，覆盖主窗口的会话元数据。
 */

export function designConversationCwd(id: string): string | undefined {
  const state = useSessionsStore.getState();
  const conversation = state.conversations[id];
  const project = useSettingsStore
    .getState()
    .projects.find((p) => p.id === conversation?.projectId);
  return sessionWorkspaceCwd(project, id, state.conversations);
}

/**
 * 主窗口里把一段派活交给指定会话：忙碌闸门、Composer 同款模型解析、经 sessions store 发送。
 * 主窗口画布与独立设计窗口的转发请求共用这一条路径。
 */
export async function deliverDesignPrompt(
  id: string,
  text: string,
  skipIfStreaming: boolean
): Promise<SendPromptResult> {
  const state = useSessionsStore.getState();
  const session = state.conversations[id];
  const cwd = designConversationCwd(id);
  if (!session || !cwd) throw new Error('Design conversation workspace is unavailable');
  if (skipIfStreaming && (session.status === 'running' || session.spawning || session.compaction))
    return { status: 'failed' };
  const settings = useSettingsStore.getState();
  const project = settings.projects.find((item) => item.id === session.projectId);
  const model = resolveChatModel({
    defaultModel: settings.defaultModel,
    ...scopedDefaultModels(project, settings.projectGroups),
    lastProviderId: session.lastProviderId,
    lastModelId: session.lastModelId,
    providers: readMaterializedProviders(),
    credentials: oauthCredentialContext(useOauthCredentialStore.getState().snapshot),
    virtualModels: settings.virtualModels,
  });
  if (model.source === 'none') throw new Error('Design prompt requires an available session model');
  const error = await useSessionsStore.getState().send(
    text,
    {
      providerId: model.providerId,
      modelId: model.modelId,
      cwd,
    },
    undefined,
    id
  );
  return error
    ? { status: 'failed', error: { message: error } }
    : { status: session.status === 'running' ? 'queued' : 'sent' };
}

export function createMainDesignHost(): DesignContextHost {
  const activityTarget = (cwd?: string) => {
    const currentConversation = currentDesignConversation();
    const state = useSessionsStore.getState();
    const viewed = viewedDesignSessionId(state.conversations, state.activeId);
    if (cwd === undefined) return viewed === currentConversation.id ? viewed : null;
    // Main has already resolved the viewed session's root. Its stored worktree
    // path can still be an alias (/tmp versus /private/tmp on macOS).
    if (viewed === currentConversation.id && cwd === currentConversation.cwd) return viewed;
    return resolveDesignActivitySession(
      Object.keys(state.conversations).map((id) => ({
        id,
        cwd: designConversationCwd(id),
      })),
      viewed,
      cwd
    );
  };
  const promptTarget = () => {
    // Bot canvases (including sessionless workspace previews) never own the hidden Code composer.
    if (isBotModeActive()) return null;
    const state = useSessionsStore.getState();
    return resolveDesignPromptTarget(
      viewedDesignSessionId(state.conversations, state.activeId),
      useDesignRegistry.getState().canvasSessionId,
      currentDesignConversation().id
    );
  };
  return {
    ui: {
      // 宿主核心已登记 activity 状态；这里只负责把画布 Dock 露出到正确的会话。
      openActivityTab: (id, options) => {
        if (id !== CANVAS_TAB_ID) return;
        // Explicit-cwd requests can arrive late from background/cancelled tools.
        const state = useSessionsStore.getState();
        const viewed = viewedDesignSessionId(state.conversations, state.activeId);
        if (
          options?.cwd &&
          (!isDesignViewingCwd(options.cwd) || !viewed || currentDesignConversation().id !== viewed)
        )
          return;
        const target = activityTarget(options?.cwd);
        if (!target) return;
        const sessions = useSessionsStore.getState();
        const parentId = sessions.conversations[target]?.parentId;
        if (parentId) {
          sessions.selectConversation(parentId);
          sessions.selectTab(parentId, target);
        } else if (sessions.activeId !== target) sessions.selectConversation(target);
        updateDesignUi(`visible:${designConversationCwd(target)}:${id}`, true);
        addSidePanelDesign({
          conversationId: target,
          title: translate('tab.label'),
          width: options?.width,
        });
      },
      setActivityTabVisible: (id, visible, options) => {
        const target = activityTarget(options?.cwd);
        updateDesignUi(
          `visible:${target ? designConversationCwd(target) : (options?.cwd ?? currentDesignConversation().cwd)}:${id}`,
          visible
        );
        if (id === CANVAS_TAB_ID && target) setSidePanelDesignVisible(target, visible);
      },
      setActivityPanelWidth: (width) => {
        const target = useSessionsStore.getState().activeId;
        if (!target) return;
        // 画布每次挂载都会要「max」：拉满面板，但不全屏盖住会话区
        if (width === 'max') useSidePanelStore.getState().maximize(target);
        else useSidePanelStore.getState().setWidth(target, width);
      },
      openWorkspaceView: (id) => {
        if (id === GALLERY_VIEW_ID) openDesignGallery();
        else throw new Error(`Unknown design workspace view: ${id}`);
      },
      setPromptAttachment: (attachment) => {
        const id = promptTarget();
        if (!id) throw new Error('No matching design composer');
        setDesignPromptAttachment(id, attachment);
      },
    },
    conversation: {
      async sendPrompt(text, canvas) {
        const id = promptTarget();
        if (!id) throw new Error('No active design conversation');
        const cwd = designConversationCwd(id);
        if (!useSessionsStore.getState().conversations[id] || !cwd)
          throw new Error('Design conversation workspace is unavailable');
        if (
          canvas &&
          (canvas.sessionId !== id ||
            (canvas.cwd !== cwd && canvas.cwd !== currentDesignConversation().cwd))
        ) {
          throw new Error('The design canvas is no longer in the active conversation');
        }
        return deliverDesignPrompt(id, text, Boolean(canvas?.skipIfStreaming));
      },
      async createSession(cwd) {
        const project = useSettingsStore
          .getState()
          .projects.find((p) => p.path === cwd && p.kind !== 'ssh');
        if (!project) throw new Error('Design session requires an existing local project');
        const id = await useSessionsStore.getState().newConversation(project.id);
        if (!id) throw new Error('Could not create design conversation');
        await resolveDesignRoot({ kind: 'session', sessionId: id });
        return { id, cwd, sessionPath: null, model: null, isStreaming: false };
      },
      insertText: (text) => {
        const id = promptTarget();
        if (!id) throw new Error('No matching design composer');
        insertDesignComposerText(id, text);
      },
    },
    sessions: {
      async list(cwd) {
        const state = useSessionsStore.getState();
        return Object.values(state.conversations)
          .filter(
            (c) =>
              !c.parentId &&
              !c.btwParentId &&
              !c.historyOnly &&
              designConversationCwd(c.id) === cwd &&
              c.sessionFile
          )
          .map((c) => ({
            path: c.sessionFile!,
            cwd,
            modifiedAt: c.lastActiveAt ?? c.createdAt,
            access: {
              readHistory: true,
              interactiveResume: c.status !== 'running',
              rename: true,
              delete: true,
            },
          }))
          .sort((a, b) => b.modifiedAt - a.modifiedAt);
      },
      async listRunningCwds() {
        return [
          ...new Set(
            Object.values(useSessionsStore.getState().conversations)
              .filter((c) => c.status === 'running')
              .map((c) => designConversationCwd(c.id))
              .filter((cwd): cwd is string => Boolean(cwd))
          ),
        ];
      },
      async open(input) {
        const state = useSessionsStore.getState();
        const conversation = Object.values(state.conversations).find(
          (c) => c.sessionFile === input.sessionPath && designConversationCwd(c.id) === input.cwd
        );
        if (!conversation) throw new Error('Design session not found');
        if (conversation.parentId || conversation.btwParentId || conversation.historyOnly)
          throw new Error('Gallery navigation requires a root conversation');
        showLocalCodeView();
        closeDesignGallery();
        state.selectConversation(conversation.id);
      },
    },
    navigation: {
      async open(input) {
        if (input.target !== 'new-session' || !input.cwd)
          throw new Error('Unsupported design navigation target');
        const project = useSettingsStore
          .getState()
          .projects.find((entry) => entry.kind !== 'ssh' && entry.path === input.cwd);
        if (!project) throw new Error('Local design project not found');
        await resolveDesignRoot({ kind: 'project', projectId: project.id });
        showLocalCodeView();
        closeDesignGallery();
        const id = await useSessionsStore.getState().newConversation(project.id);
        if (!id) throw new Error('Could not create design conversation');
        // This is a user-initiated navigation, never an automatic send. Append to
        // an existing empty session's local draft rather than discarding it.
        if (input.draft)
          useSessionsStore.setState((state) => {
            const conversation = state.conversations[id];
            if (!conversation) return state;
            return {
              conversations: {
                ...state.conversations,
                [id]: { ...conversation, draftText: input.draft, draftAppend: true },
              },
            };
          });
        updateDesignUi('navigation', { ...input, sessionId: id });
        return input;
      },
    },
  };
}
