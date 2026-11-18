import { Check, Laptop, Palette, Pencil, Plus, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { StoredDevice } from './deviceList';
import { PhoneTopBar } from './PhoneTopBar';
import type { PushFailureReason } from './push';
import { readOnlyBanner } from './readOnly';
import {
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from './theme';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'auto', label: '跟随桌面' },
  { value: 'light', label: '浅' },
  { value: 'dark', label: '深' },
];

const PUSH_ERROR_TEXT: Record<PushFailureReason, string> = {
  unsupported: '当前浏览器不支持推送。',
  'permission-denied': '通知权限被拒绝，请在浏览器站点设置中允许后重试。',
  'service-unreachable': '无法连接 Google 推送服务（FCM），请检查网络或代理后重试。',
  'subscribe-failed': '订阅失败，请稍后重试。',
};

/**
 * 设备与通知（设计稿 `settings.tsx`）：连接、这台手机的权限、推送、已配对电脑
 * 全在一页，抽屉底部不再挂主题/推送/设备设置。只读权限由桌面下发，手机不改写。
 */
export function PhoneSettingsScreen({
  open,
  onClose,
  devices,
  activeDevicePairId,
  connected,
  connectionLabel,
  deviceReadOnly = false,
  pushEnabled,
  pushBusy,
  pushError,
  pushAvailability,
  pushConfigReady,
  onTogglePush,
  onSwitchDevice,
  onAddDevice,
  onRenameDevice,
  onUnpairDevice,
}: {
  open: boolean;
  onClose(): void;
  devices: StoredDevice[];
  activeDevicePairId: string | null;
  connected: boolean;
  connectionLabel: string;
  deviceReadOnly?: boolean;
  pushEnabled: boolean;
  pushBusy: boolean;
  pushError: PushFailureReason | null;
  pushAvailability: 'ok' | 'needs-install' | 'unsupported';
  pushConfigReady: boolean;
  onTogglePush(next: boolean): void;
  onSwitchDevice(pairId: string): void;
  onAddDevice(): void;
  onRenameDevice(pairId: string, label: string): void;
  onUnpairDevice(pairId: string): void;
}) {
  const [themePref, setThemePref] = useState<ThemePreference>(getThemePreference);
  const [confirmUnpair, setConfirmUnpair] = useState<string | null>(null);
  useEffect(() => subscribeTheme(() => setThemePref(getThemePreference())), []);
  useEffect(() => {
    if (!open) setConfirmUnpair(null);
  }, [open]);
  if (!open) return null;

  const activeDevice = devices.find((device) => device.pairId === activeDevicePairId) ?? null;
  const pushDisabled = pushBusy || pushAvailability !== 'ok' || !connected || !pushConfigReady;

  return (
    <div className="phone-settings fixed inset-0 z-50 flex flex-col bg-page pb-safe">
      <PhoneTopBar
        lead="back"
        onLead={onClose}
        leadLabel="返回会话列表"
        title="设备与通知"
        className="pr-4"
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-10">
        <p className="pb-1 text-[12px] leading-4 text-dim">当前连接</p>
        <div className="flex items-center gap-3 rounded-[16px] bg-card px-3.5 py-3">
          <Laptop className="size-5 shrink-0 text-ink2" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] leading-5 font-medium">
              {activeDevice?.label ?? '未配对电脑'}
            </p>
            <p className="flex items-center gap-1.5 truncate text-[12px] leading-4 text-dim">
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  connected ? 'bg-green' : 'bg-faint'
                )}
              />
              {connected
                ? `已连接 · ${activeDevice?.relayUrl.replace(/^https?:\/\//, '').split('/')[0] ?? ''}`
                : connectionLabel}
            </p>
          </div>
          {devices.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const next = devices.find((device) => device.pairId !== activeDevicePairId);
                if (next) onSwitchDevice(next.pairId);
              }}
              className="shrink-0 text-[13px] leading-5 font-medium text-ink2"
            >
              切换
            </button>
          )}
        </div>

        <p className="pt-6 pb-1 text-[12px] leading-4 text-dim">这台手机</p>
        <div className="flex items-center gap-3 rounded-[16px] bg-card px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-5 font-medium">
              {deviceReadOnly ? '只读' : '可操作'}
            </p>
            <p className="text-[12px] leading-4 text-dim">
              {deviceReadOnly ? readOnlyBanner(false) : '能发消息、批审批、开新会话'}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-card2 px-2.5 py-1 text-[11px] leading-4 font-medium text-ink2">
            桌面设置
          </span>
        </div>
        <p className="pt-2 text-[11px] leading-4 text-faint">
          只读由桌面「设置 → 设备」决定，手机上不能改。
        </p>

        <p className="pt-6 pb-1 text-[12px] leading-4 text-dim">通知</p>
        <div className="flex items-center gap-3 rounded-[16px] bg-card px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-5 font-medium">推送通知</p>
            <p className="text-[12px] leading-4 text-dim">等审批、任务完成、断线时提醒</p>
          </div>
          <Switch
            aria-label="推送通知"
            checked={pushEnabled}
            disabled={pushDisabled}
            onCheckedChange={onTogglePush}
          />
        </div>
        {pushBusy && <p className="pt-2 text-[11px] leading-4 text-faint">正在开启…</p>}
        {pushError && !pushBusy && (
          <p role="alert" className="pt-2 text-[11px] leading-4 text-red">
            {PUSH_ERROR_TEXT[pushError]}
          </p>
        )}
        {pushAvailability === 'ok' && connected && !pushConfigReady && (
          <p className="pt-2 text-[11px] leading-4 text-faint">
            需先升级桌面端 CodeKiln 才能开启推送。
          </p>
        )}
        {pushAvailability === 'needs-install' && (
          <p className="pt-2 text-[11px] leading-4 text-faint">
            iOS 要先「添加到主屏幕」，从主屏幕打开推送才可开。
          </p>
        )}
        {pushAvailability === 'unsupported' && (
          <p className="pt-2 text-[11px] leading-4 text-faint">当前浏览器不支持推送。</p>
        )}
        <p className="pt-6 pb-1 text-[12px] leading-4 text-dim">外观</p>
        <div className="flex items-center gap-3 rounded-[16px] bg-card px-3.5 py-3">
          <Palette className="size-5 shrink-0 text-ink2" aria-hidden />
          <span className="min-w-0 flex-1 text-[15px] leading-5 font-medium">主题</span>
          <div className="flex shrink-0 gap-0.5 rounded-full bg-card2 p-0.5">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setThemePreference(option.value)}
                aria-pressed={themePref === option.value}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] leading-4 transition-colors',
                  themePref === option.value
                    ? 'bg-card font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                    : 'text-dim'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <p className="pt-6 pb-1 text-[12px] leading-4 text-dim">已配对电脑</p>
        <div className="rounded-[16px] bg-card">
          {devices.map((device, index) => {
            const isActive = device.pairId === activeDevicePairId;
            if (confirmUnpair === device.pairId) {
              return (
                <div
                  key={device.pairId}
                  className={cn('px-3.5 py-3', index > 0 && 'border-line/60 border-t')}
                >
                  <p className="text-[13px] leading-[18px]">
                    解绑「{device.label}」后需重新扫码才能连接，确定吗？
                  </p>
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmUnpair(null)}
                      className="h-9 rounded-full bg-card2 px-3.5 text-[13px] font-medium text-ink2"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmUnpair(null);
                        onUnpairDevice(device.pairId);
                      }}
                      className="h-9 rounded-full bg-card2 px-3.5 text-[13px] font-medium text-red"
                    >
                      确定解绑
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div
                key={device.pairId}
                className={cn(
                  'flex items-center gap-3 px-3.5 py-3',
                  index > 0 && 'border-line/60 border-t'
                )}
              >
                <button
                  type="button"
                  onClick={() => onSwitchDevice(device.pairId)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Laptop className="size-5 shrink-0 text-ink2" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] leading-5 font-medium">
                      {device.label}
                    </span>
                    <span className="flex items-center gap-1.5 text-[12px] leading-4 text-dim">
                      {isActive
                        ? connected
                          ? '当前连接 · 已连接'
                          : '当前连接 · 未连接'
                        : '未连接'}
                    </span>
                  </span>
                  {isActive && <Check className="size-4 shrink-0 text-green" aria-hidden />}
                </button>
                <button
                  type="button"
                  aria-label={`重命名 ${device.label}`}
                  onClick={() => {
                    const label = window.prompt('给这台电脑起个名：', device.label);
                    if (label?.trim()) onRenameDevice(device.pairId, label);
                  }}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-faint"
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`解绑 ${device.label}`}
                  onClick={() => setConfirmUnpair(device.pairId)}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-faint"
                >
                  <Unplug className="size-4" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onAddDevice}
          className="mt-2 flex w-full items-center gap-3 rounded-[16px] bg-card px-3.5 py-3 text-left"
        >
          <Plus className="size-5 shrink-0 text-ink2" aria-hidden />
          <span className="flex-1 text-[15px] leading-5 font-medium">配对新电脑</span>
        </button>
        {activeDevice && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`解绑「${activeDevice.label}」后需要重新扫码，确定吗？`))
                onUnpairDevice(activeDevice.pairId);
            }}
            className="mt-6 h-12 w-full rounded-full bg-card text-[15px] font-medium text-red"
          >
            解绑这台手机
          </button>
        )}
        <p className="pt-6 text-center text-[11px] leading-4 text-faint">版本 {__COMMIT__}</p>
      </div>
    </div>
  );
}
