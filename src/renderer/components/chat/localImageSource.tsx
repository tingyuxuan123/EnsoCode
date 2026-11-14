import { toLocalImageUrl } from '@shared/localImage';
import { useCallback, useEffect, useState } from 'react';
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

export function useLocalImageSource(path: string): {
  state: LocalImageSource;
  remote: boolean;
  retry: () => void;
} {
  const read = useChatHost()?.readLocalImage;
  const remote = Boolean(read);
  const [state, setState] = useState<LocalImageSource>(() =>
    initialLocalImageSource(path, Boolean(read))
  );
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt 是重试信号，path/read 变化都要重读
  useEffect(() => {
    if (!read) {
      setState(initialLocalImageSource(path, false));
      return;
    }
    let alive = true;
    setState({ status: 'loading' });
    read(path)
      .then((load) => {
        if (alive) setState(applyLocalImageLoad(load));
      })
      .catch(() => {
        if (alive) setState({ status: 'error', error: 'failed' });
      });
    return () => {
      alive = false;
    };
  }, [read, path, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, remote, retry };
}
