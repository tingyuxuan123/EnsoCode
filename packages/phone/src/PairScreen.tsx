import { claimPairing, type PairedDevice, parsePairUri } from '@enso/pair';

import { Link2, Loader2, ScanLine, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createQrScanner } from './qr';

/** 扫到的内容是否是配对码（能解析出 relay + 公钥即可） */
function isPairPayload(value: string): boolean {
  try {
    parsePairUri(value);
    return true;
  } catch {
    return false;
  }
}

/** 三步说明：照抄设计稿，只有扫码与粘贴链接两条路，没有数字配对码。 */
const STEPS = [
  '桌面端「设置 → 手机」→ 允许连入',
  '用系统相机扫它出的二维码，会直接打开这一页并连上',
  '扫码不方便，就在下面粘贴那条链接',
] as const;

/** 配对页：晨光 + 两行大字 + 三步说明 + 粘贴链接 + 扫码。 */
export function PairScreen({
  onPaired,
  autoInvite,
  onCancel,
}: {
  onPaired: (device: PairedDevice) => void;
  /** 扫码直达时从地址栏取到的邀请链接，挂载后自动完成配对 */
  autoInvite?: string | null;
  /** 已配对状态下添加新电脑时提供：显示关闭按钮 */
  onCancel?: () => void;
}) {
  const [uri, setUri] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopScan = () => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setScanning(false);
  };
  const pair = async (raw: string) => {
    setBusy(true);
    setError(null);
    try {
      const invite = parsePairUri(raw);
      const deviceName = /iPhone|iPad|Android/i.exec(navigator.userAgent)?.[0] ?? 'Phone';
      const result = await claimPairing(invite.relay, invite.publicKey, deviceName);
      onPaired({
        pairId: result.pairId,
        token: result.deviceToken,
        contentKey: btoa(String.fromCharCode(...result.contentKey))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, ''),
        deviceName,
        relayUrl: invite.relay,
        pairedAt: Date.now(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 扫码直达：地址栏带邀请时直接配对，用户无需再点任何按钮
  const autoRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: autoInvite 是触发信号，只跑一次
  useEffect(() => {
    if (!autoInvite || autoRef.current) return;
    autoRef.current = true;
    void pair(autoInvite);
  }, [autoInvite]);

  // 扫到码后的动作：effect 只依赖 scanning，经 ref 取最新实现，避免依赖抖动导致重挂
  const onDetectedRef = useRef<(value: string) => void>(() => {});
  onDetectedRef.current = (value: string) => {
    stopScan();
    void pair(value);
  };

  const startScan = async () => {
    setError(null);
    try {
      // 只负责拿流；挂到 <video> 与解码循环交给下面的 effect——
      // setScanning 是异步的，此刻 <video> 还没挂载，直接读 ref 必然为 null
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      setScanning(true);
    } catch (e) {
      // 非 HTTPS / 非 localhost 时 getUserMedia 不可用，提示要具体
      setError(
        !window.isSecureContext
          ? '扫码需要 HTTPS 环境，请改用粘贴配对码'
          : e instanceof DOMException && e.name === 'NotAllowedError'
            ? '摄像头权限被拒绝，请在浏览器设置中允许后重试'
            : '无法访问摄像头，请粘贴配对码'
      );
      setScanning(false);
    }
  };

  /** 页内「粘贴」：读剪贴板填进输入行，能解析就直接配对 */
  const pasteFromClipboard = async () => {
    setError(null);
    try {
      const text = (await navigator.clipboard?.readText()) ?? '';
      const trimmed = text.trim();
      if (!trimmed) {
        setError('剪贴板里没有链接，请先在桌面端点「复制链接」');
        return;
      }
      setUri(trimmed);
      if (isPairPayload(trimmed)) void pair(trimmed);
      else setError('这段内容不是配对链接，请确认复制的是桌面端那条 codekiln:// 链接');
    } catch {
      setError('读不到剪贴板，请手动把链接粘贴到输入框');
    }
  };

  // 进入扫码态后 <video> 才存在，此时才能挂流并起解码循环
  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    let cancelled = false;
    let raf = 0;
    video.srcObject = stream;
    // iOS 要求静音才允许内联自动播放；React 的 muted 属性有时不落到 DOM，显式再设一次
    video.muted = true;

    void (async () => {
      try {
        await video.play();
        const scanner = await createQrScanner();
        const tick = async () => {
          if (cancelled || !streamRef.current) return;
          try {
            const value = await scanner.scan(video);
            // 兼容两种码：桌面新版发 https 链接（系统相机也能直接打开），旧版是 codekiln:// scheme
            if (value && isPairPayload(value)) {
              onDetectedRef.current(value);
              return;
            }
          } catch {}
          raf = requestAnimationFrame(() => void tick());
        };
        await tick();
      } catch {
        if (!cancelled) setError('无法开始预览，请粘贴配对码');
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [scanning]);

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-page text-ink">
      <div className="phone-dawn" />

      <header className="phone-pair-header relative flex items-center gap-2.5 px-5">
        <img src="/icons/logo-192.png" alt="" className="size-[26px] shrink-0" />
        <span className="text-[17px] leading-6 font-semibold">CodeKiln</span>
        <div className="flex-1" />
        <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-card2 px-2">
          <span className="size-1.5 rounded-full bg-faint" />
          <span className="text-[11px] leading-4 font-medium text-ink2">未连接</span>
        </span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="关闭"
            className="flex size-12 items-center justify-center rounded-full text-ink"
          >
            <X className="size-6" aria-hidden />
          </button>
        )}
      </header>

      <div className="relative px-5 pt-9">
        <h1 className="text-[31px] leading-[38px] font-bold tracking-[-0.02em]">
          手机是
          <br />
          <span className="phone-greet">第二块屏幕</span>
        </h1>
        <p className="mt-3.5 max-w-[300px] text-[15px] leading-6 text-dim">
          把它和正在跑任务的电脑连起来。看一眼进度，批一条命令，回一句话——不用走到桌前。
        </p>
      </div>

      <ol className="relative mt-7 flex flex-col gap-2.5 px-5">
        {STEPS.map((step, index) => (
          <li key={step} className="flex items-start gap-2.5 text-[14px] leading-5 text-ink2">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-pill text-[11px] font-semibold text-pill-ink tabular-nums">
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      <div className="relative mt-6 px-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] leading-5 font-semibold">粘贴配对链接</h2>
          <span className="text-[12px] leading-4 text-dim">在桌面端点「复制链接」</span>
        </div>
        <div className="mt-3 flex h-[54px] items-center gap-2 rounded-[18px] bg-card pr-1.5 pl-4 shadow-[inset_0_0_0_0.75px_rgb(0_0_0/0.06)]">
          <Link2 className="size-4 shrink-0 text-faint" aria-hidden />
          <input
            value={uri}
            onChange={(event) => setUri(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && uri.trim()) void pair(uri.trim());
            }}
            placeholder="codekiln://pair?relay=…&pk=…"
            aria-label="配对链接"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:text-faint"
          />
          <button
            type="button"
            onClick={() => void pasteFromClipboard()}
            disabled={busy}
            className="flex h-11 shrink-0 items-center rounded-full bg-card2 px-4 text-[14px] leading-5 font-medium text-ink2 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : '粘贴'}
          </button>
        </div>
        <p className="mt-2.5 text-[12px] leading-4 text-dim">链接只在桌面端显示的倒计时内有效</p>
      </div>

      {error && (
        <p className="relative mx-5 mt-3 rounded-[14px] bg-red/5 px-3.5 py-2.5 text-[12px] leading-[18px] text-red">
          {error}
        </p>
      )}

      <div className="flex-1" />

      {scanning ? (
        <div className="relative mt-6 px-5">
          <video
            ref={videoRef}
            playsInline
            muted
            className="aspect-square w-full rounded-[20px] bg-ink object-cover"
          />
          <button
            type="button"
            onClick={stopScan}
            className="mt-2.5 h-12 w-full rounded-full bg-card2 text-[15px] font-medium text-ink2"
          >
            取消扫码
          </button>
        </div>
      ) : null}

      <div className="phone-pair-footer relative px-5 pt-6">
        <button
          type="button"
          onClick={() => void startScan()}
          disabled={busy}
          className="glass-ink flex h-[54px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-medium disabled:opacity-60"
        >
          <ScanLine className="size-5" aria-hidden />
          扫描二维码
        </button>
        <p className="mt-2 px-6 pb-8 text-center text-[12px] leading-4 text-dim">
          页内扫码需要摄像头权限；系统相机扫同一张码也能连
        </p>
      </div>
    </div>
  );
}
