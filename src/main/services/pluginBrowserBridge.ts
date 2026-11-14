import { setTimeout as delay } from 'node:timers/promises';
import type { PluginInspectEntry } from '@shared/browser/inspection';
import { isWpsDocumentUrl, parseWpsRangeAddress } from '@shared/browser/wpsRange';
import {
  type PluginBrowserBridgeInput,
  type PluginBrowserOp,
  pluginBrowserUrl,
} from '@shared/extensionPlugins/browserBridge';
import type { BrowserActor } from './browserTabClaims';

/** 插件桥允许落到 BrowserHost 的正式 op；`read` 复用宿主的 read_text 投影 */
export type PluginBrowserHostOp =
  | 'navigate'
  | 'snapshot'
  | 'read_text'
  | 'click'
  | 'fill'
  | 'press_key'
  /** 内部 op：固定脚本捕获复制选区，不进 worker / 模型的 BrowserOp 闭集 */
  | 'plugin_copy_selection'
  /** 内部 op：固定 DOM 校验后向 activeElement 原生插入文本 */
  | 'plugin_insert_text'
  | 'plugin_read_wps_range';

export interface PluginBrowserSessionGrant {
  ok: true;
  /** 宿主会话键（本机根会话即会话 id） */
  sessionKey: string;
  actor?: BrowserActor;
  /** 冷 UI 读取绑定 Main 权威会话版本；不替代 worker 的 generation。 */
  authorityVersion?: number;
}

export interface PluginBrowserSessionDenied {
  ok: false;
  code: string;
  message: string;
}

export type PluginBrowserAuthorizeResult = PluginBrowserSessionGrant | PluginBrowserSessionDenied;

export interface PluginBrowserRunInput {
  sessionKey: string;
  op: PluginBrowserHostOp;
  params: Record<string, unknown>;
  actor?: BrowserActor;
  signal: AbortSignal;
  guard: () => void;
}

export interface PluginBrowserInspectInput {
  sessionKey: string;
  tabId: string;
  selector: string;
  actor?: BrowserActor;
  signal: AbortSignal;
  guard: () => void;
}

/**
 * Main 侧桥的依赖缝：身份、tab 归属与宿主执行都由 agent.ts 注入，
 * 这样会话/工具开关、BrowserHost 队列与取消都能单独验证。
 */
export interface PluginBrowserBridgeDeps {
  /** 本机根会话 + 就绪 + generation 匹配 + 浏览器工具未被禁用 */
  authorizeSession(input: PluginBrowserBridgeInput): PluginBrowserAuthorizeResult;
  /** 动作执行后会话是否仍然有效（generation 变化、回合结束都算失效） */
  isSessionCurrent(input: PluginBrowserBridgeInput, grant: PluginBrowserSessionGrant): boolean;
  /** tab 归属与权威 URL；未知或跨会话返回 null */
  authoritativeUrl(sessionKey: string, tabId: string): string | null;
  /** navigate 之后 Main 为会话选定的 tab */
  currentTabId(sessionKey: string): string | null;
  run(input: PluginBrowserRunInput): Promise<unknown>;
  inspect(input: PluginBrowserInspectInput): Promise<PluginInspectEntry[]>;
}

const HOST_OPS: Record<
  Exclude<PluginBrowserOp, 'navigate' | 'inspect' | 'read_range'>,
  PluginBrowserHostOp
> = {
  snapshot: 'snapshot',
  read: 'read_text',
  click: 'click',
  fill: 'fill',
  press_key: 'press_key',
  copy_selection: 'plugin_copy_selection',
  insert_text: 'plugin_insert_text',
};

const denied = (code: string, message: string) => Object.assign(new Error(message), { code });

/** 只把宿主需要的字段传下去，避免把插件给的其它键带进 BrowserHost */
function hostParams(
  op: Exclude<PluginBrowserOp, 'navigate' | 'inspect' | 'read_range'>,
  params: Record<string, unknown>
): Record<string, unknown> {
  const tabId = params.tabId;
  if (op === 'click') return { tabId, ref: params.ref };
  if (op === 'fill') return { tabId, ref: params.ref, value: params.value };
  if (op === 'press_key') return { tabId, key: params.key };
  if (op === 'insert_text') return { tabId, text: params.text };
  return { tabId };
}

/**
 * 插件浏览器桥：会话与 tab 归属由 Main 权威记录决定，域名在每次动作前后各校验一次；
 * navigate 只接受 HTTPS 且 host 精确命中的地址，动作结束后按权威 URL 复查。
 */
export function createPluginBrowserBridge(deps: PluginBrowserBridgeDeps) {
  return async function pluginBrowserInvoke(input: PluginBrowserBridgeInput): Promise<unknown> {
    const { signal } = input;
    const grant = deps.authorizeSession(input);
    if (!grant.ok) throw denied(grant.code, grant.message);
    const { sessionKey, actor } = grant;
    const assertAllowedUrl = (raw: string) => {
      const url = pluginBrowserUrl(raw, input.domains);
      if (!url) {
        let location = '未完成导航';
        try {
          const observed = new URL(raw);
          location = observed.protocol === 'https:' ? observed.hostname : observed.protocol;
        } catch {}
        throw denied('PERMISSION_DENIED', `页面不在插件声明域名的 HTTPS 白名单内（${location}）`);
      }
      return url;
    };
    const assertTabAllowed = (tabId: string) => {
      const url = deps.authoritativeUrl(sessionKey, tabId);
      if (url === null) throw denied('NOT_FOUND', '浏览器 tab 不存在或不属于当前会话');
      return assertAllowedUrl(url);
    };
    // 取消与失效检查统一落在 Main 自己的错误码上，插件不用解析 DOMException 文案
    const assertCurrent = () => {
      if (signal.aborted) throw denied('ABORTED', '调用已取消');
      if (!deps.isSessionCurrent(input, grant)) throw denied('ABORTED', '浏览器会话已失效');
    };
    assertCurrent();

    if (input.op === 'read_range') {
      if (
        input.kind !== 'ui' ||
        !isWpsDocumentUrl(input.params.url) ||
        !parseWpsRangeAddress(input.params.address)
      )
        throw denied('PERMISSION_DENIED', '受限表格读取只能由本机插件界面发起');
      const requested = assertAllowedUrl(String(input.params.url));
      const documentKey = (url: URL) =>
        `${url.hostname === 'kdocs.cn' ? 'www.kdocs.cn' : url.hostname}/${/^\/(?:l\/|cms\/docs\/d\/)([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1]}`;
      let tabId = typeof input.params.tabId === 'string' ? input.params.tabId : null;
      const openedForRead = !tabId;
      if (!tabId) {
        let opened: unknown;
        try {
          opened = await deps.run({
            sessionKey,
            op: 'navigate',
            params: { url: requested.href, newTab: true },
            ...(actor ? { actor } : {}),
            signal,
            guard: assertCurrent,
          });
        } catch (error) {
          if (
            !error ||
            typeof error !== 'object' ||
            !('code' in error) ||
            error.code !== 'NAVIGATION_INTERRUPTED' ||
            !('tabId' in error) ||
            typeof error.tabId !== 'string'
          )
            throw error;
          opened = { tabId: error.tabId }; // 仅沿本次固定tab观察结果；不自动重放导航。
        }
        assertCurrent();
        tabId =
          opened &&
          typeof opened === 'object' &&
          'tabId' in opened &&
          typeof opened.tabId === 'string'
            ? opened.tabId
            : null;
        if (!tabId) throw denied('NOT_FOUND', '浏览器未返回本次读取的固定标签标识');
      }
      const fixedTab = tabId;
      if (openedForRead) {
        // WPS会在loadURL完成后经account.kdocs.cn再跳回文档。只观察URL，不给账户页任何输入授权。
        const deadline = Date.now() + 15000;
        let stableSince = 0;
        while (true) {
          assertCurrent();
          const current = deps.authoritativeUrl(sessionKey, fixedTab);
          let sso = false;
          try {
            const url = new URL(current ?? '');
            sso =
              url.protocol === 'https:' &&
              !url.username &&
              !url.password &&
              !url.port &&
              ['account.kdocs.cn', 'account.wps.cn'].includes(url.hostname);
          } catch {}
          if (current !== '' && current !== 'about:blank' && !sso) {
            let document = false;
            try {
              const url = new URL(current ?? '');
              document =
                !!pluginBrowserUrl(url.href, input.domains) &&
                isWpsDocumentUrl(url.href) &&
                documentKey(url) === documentKey(requested);
            } catch {}
            if (!document) break;
            if (!stableSince) stableSince = Date.now();
            if (Date.now() - stableSince >= 1000) break;
          } else stableSince = 0;
          if (Date.now() >= deadline)
            throw denied(
              'NOT_READY',
              sso
                ? '文档停留在登录页，请在浏览器完成登录后再读取'
                : '文档导航尚未完成，请稍后再读取'
            );
          try {
            await delay(100, undefined, { signal });
          } catch (error) {
            assertCurrent();
            throw error;
          }
        }
      }
      const guard = () => {
        assertCurrent();
        const actual = assertTabAllowed(fixedTab);
        if (!isWpsDocumentUrl(actual.href) || documentKey(actual) !== documentKey(requested))
          throw denied('ABORTED', '文档已变化，已停止读取');
      };
      guard();
      const result = await deps.run({
        sessionKey,
        op: 'plugin_read_wps_range',
        params: { tabId: fixedTab, address: input.params.address },
        ...(actor ? { actor } : {}),
        signal,
        guard,
      });
      guard();
      return { ...(result && typeof result === 'object' ? result : {}), tabId: fixedTab };
    }

    if (input.op === 'navigate') {
      const requested = assertAllowedUrl(String(input.params.url));
      const result = await deps.run({
        sessionKey,
        op: 'navigate',
        params: { url: requested.href, newTab: input.params.newTab === true },
        ...(actor ? { actor } : {}),
        signal,
        guard: assertCurrent,
      });
      assertCurrent();
      const tabId =
        result &&
        typeof result === 'object' &&
        'tabId' in result &&
        typeof result.tabId === 'string'
          ? result.tabId
          : null;
      if (!tabId) throw denied('NOT_FOUND', '浏览器未返回本次导航的固定标签标识');
      // 页面可能自己跳到别处：按 Main 持有的 tab 复查权威 URL
      assertTabAllowed(tabId);
      return { ...(result && typeof result === 'object' ? result : {}), tabId };
    }

    const tabId = String(input.params.tabId);
    const observed = assertTabAllowed(tabId);
    const guard = () => {
      assertCurrent();
      const actual = assertTabAllowed(tabId);
      if (actual.href.split('#')[0] !== observed.href.split('#')[0])
        throw denied('ABORTED', '排队期间文档已变化，未继续操作');
    };
    const result =
      input.op === 'inspect'
        ? await deps.inspect({
            sessionKey,
            tabId,
            selector: String(input.params.selector),
            ...(actor ? { actor } : {}),
            signal,
            guard,
          })
        : await deps.run({
            sessionKey,
            op: HOST_OPS[input.op],
            params: hostParams(input.op, input.params),
            ...(actor ? { actor } : {}),
            signal,
            guard,
          });
    assertCurrent();
    assertTabAllowed(tabId);
    return result;
  };
}
