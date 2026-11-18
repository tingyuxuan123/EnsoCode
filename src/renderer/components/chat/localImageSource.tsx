import { toLocalImageUrl } from '@shared/localImage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatHost } from './chatHost';

/**
 * 会话里的本地图片（read / 生成图片）来源：
 * - 桌面：`local-image://` 特权协议，由 Main 直接读盘（现状不变）；
 * - 手机 PWA：浏览器不认这个协议，必须经 host 通道按「会话 id + 工作区相对路径」取回 data URL。
 * 没有远程能力时保持桌面行为；有远程能力时**加载中/失败都要有可见状态**，不能空白。
 */

export type LocalImageSource =
  | { status: 'local'; src: string }
  | { status: 'loading' }
  | { status: 'ready'; src: string }
  | { status: 'error'; error: string };

export function initialLocalImageSource(path: string, remote: boolean): LocalImageSource {
  return remote ? { status: 'loading' } : { status: 'local', src: toLocalImageUrl(path) };
}

export function applyLocalImageLoad(load: {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}): LocalImageSource {
  if (load.ok && typeof load.dataUrl === 'string' && load.dataUrl.startsWith('data:image/'))
    return { status: 'ready', src: load.dataUrl };
  return { status: 'error', error: load.ok ? 'invalid' : (load.error ?? 'failed') };
}

/** 失败原因 → 界面文案（不暴露磁盘路径） */
export function localImageErrorText(error: string, t: (key: string) => string): string {
  switch (error) {
    case 'too-large':
      return t('Image is too large to preview on the phone');
    case 'unsupported':
      return t('This image format cannot be previewed here');
    case 'not-found':
    case 'changed':
      return t('Image was changed or moved');
    case 'unavailable':
      return t('This computer cannot read the file right now');
    case 'offline':
    case 'timeout':
      return t('Connection lost, try again when reconnected');
    case 'outside':
      return t('This image is outside the session folder');
    default:
      return t('Could not load the image');
  }
}

export function useLocalImageSource(
  path: string,
  toolCallId?: string
): {
  state: LocalImageSource;
  remote: boolean;
  /** 重试 = 先作废宿主缓存再重新取图（同路径覆盖/坏图都必须真重取） */
  retry: () => void;
  /** 解码失败时立刻作废该图缓存，避免重试又拿回同一份坏像素 */
  invalidate: () => void;
} {
  const host = useChatHost();
  const read = host?.readLocalImage;
  const remote = Boolean(read);
  // 会话/执行目录换代：同一相对路径要重新取图，不能让已挂载的旧像素留着
  const scope = host?.localImageScope ?? '';
  // 宿主可能每次渲染都传新的函数身份：只跟随「有没有远程能力」这个布尔，
  // 否则断线时一次请求/通知会触发重渲染 → 新身份 → 再请求，永远停在加载态。
  const readRef = useRef(read);
  readRef.current = read;
  const [state, setState] = useState<LocalImageSource>(() => initialLocalImageSource(path, remote));
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只跟随能力开关、路径、资源代次与重试信号
  useEffect(() => {
    const load = readRef.current;
    if (!load) {
      setState(initialLocalImageSource(path, false));
      return;
    }
    let alive = true;
    setState({ status: 'loading' });
    const pending = toolCallId ? load(path, toolCallId) : load(path);
    pending
      .then((result) => {
        if (alive) setState(applyLocalImageLoad(result));
      })
      .catch(() => {
        if (alive) setState({ status: 'error', error: 'failed' });
      });
    return () => {
      alive = false;
    };
  }, [remote, path, toolCallId, scope, attempt]);
  const invalidate = useCallback(() => {
    if (!host?.invalidateLocalImage) return;
    if (toolCallId) host.invalidateLocalImage(path, toolCallId);
    else host.invalidateLocalImage(path);
  }, [host, path, toolCallId]);
  const retry = useCallback(() => {
    // 先失效再重取：不然手机侧的「成功缓存」会把坏图/旧图原样还回来
    invalidate();
    setAttempt((value) => value + 1);
  }, [invalidate]);
  return { state, remote, retry, invalidate };
}
