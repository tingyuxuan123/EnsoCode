// The side panel's Mobile devices pane: the devices a session holds, one tab each, the chosen
// device's live screen under them, and its hardware buttons under that.

import { type DeviceAppearance, type DeviceInfo, SESSION_DEVICE_LIMIT } from '@shared/device-host';
import {
  AlertTriangle,
  Camera,
  Circle,
  CircleStop,
  Ellipsis,
  House,
  LayoutGrid,
  Lock,
  MonitorSmartphone,
  Moon,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Smartphone,
  Sun,
  Tablet,
  Unlink,
  Volume1,
  Volume2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  closeDevice,
  controlDevice,
  type DeviceStream,
  devicesOf,
  loadDevices,
  moveDevice,
  openDevice,
  selectDevice,
  setDeviceStream,
  shutDownDevice,
  useDevicesStore,
} from '@/stores/devices';
import { deviceBridge } from './bridge';
import { canRecord, saveScreenshot, startRecording, stopRecording } from './device-capture';
import { DevicePermissions } from './device-permissions';
import { DeviceRequest } from './device-request';
import { DeviceScreen } from './device-screen';
import { DeviceSetup, HostSetupPanel } from './device-setup';
import { DEVICES_KEYS, devicesText } from './i18n';
import { PaneBody, PaneHead, PanelButton, PaneSheet } from './panel';
import { clockOf, useSeconds } from './support';

type Icon = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

/** A device's mark: one for simulators and emulators, the device's form for a physical one. */
function markOf(device: DeviceInfo): Icon {
  if (device.kind !== 'physical') return MonitorSmartphone;
  return /ipad|tablet|tab\b/i.test(`${device.name} ${device.model ?? ''}`) ? Tablet : Smartphone;
}

const DOT_COLOR = {
  neutral: 'text-muted-foreground',
  info: 'text-info',
  warning: 'text-warning',
  error: 'text-destructive',
} as const;

/** A state as a badge, with a dot for one that is happening now. */
function State({
  variant,
  dot,
  compact,
  children,
}: {
  variant: 'neutral' | 'info' | 'warning' | 'error';
  dot?: 'still' | 'live';
  /** Only a dot in the state's color, where a tab has no room for the words. */
  compact?: boolean;
  children: string;
}) {
  if (compact) {
    return (
      <span
        role="img"
        aria-label={children}
        className={cn('size-1.5 shrink-0 rounded-full bg-current', DOT_COLOR[variant])}
      />
    );
  }
  return (
    <Badge
      variant={variant === 'neutral' ? 'outline' : variant === 'error' ? 'error' : variant}
      className="gap-1"
    >
      {dot && (
        <span
          aria-hidden
          className={cn('size-1.5 rounded-full bg-current', dot === 'live' && 'animate-pulse')}
        />
      )}
      {children}
    </Badge>
  );
}

interface TabStatus {
  variant: 'neutral' | 'info' | 'warning' | 'error';
  dot?: 'still' | 'live';
  label: string;
}

/** What a device's tab says after its name, when it is anything but ready. */
function statusOf(
  device: DeviceInfo,
  stream: DeviceStream | undefined,
  /** The pane is still opening it: booted, but not yet ready to show. */
  opening: boolean
): TabStatus | null {
  if (device.problems.length > 0) return { variant: 'warning', label: DEVICES_KEYS.stateNotReady };
  if (device.state === 'booting' || opening) {
    return { variant: 'info', dot: 'live', label: DEVICES_KEYS.stateStarting };
  }
  if (device.state === 'shutdown') return { variant: 'neutral', label: DEVICES_KEYS.stateShutdown };
  if (device.state === 'unavailable')
    return { variant: 'neutral', label: DEVICES_KEYS.stateUnavailable };
  if (stream?.state !== 'stopped' && stream?.state !== 'error') return null;
  return stream.drawn
    ? { variant: 'warning', dot: 'still', label: DEVICES_KEYS.stateLost }
    : { variant: 'error', dot: 'still', label: DEVICES_KEYS.stateError };
}

/** The side panel's Mobile devices pane. */
export function DevicesPane({ conversationId }: { conversationId: string }) {
  const { t } = useI18n();
  const sessionId = conversationId;
  const devices = useDevicesStore((s) => s.devices);
  const loaded = useDevicesStore((s) => s.loaded);
  const environment = useDevicesStore((s) => s.environment);
  const error = useDevicesStore((s) => s.error);
  const opening = useDevicesStore((s) => s.opening[sessionId]);
  const selectedId = useDevicesStore((s) => s.selected[sessionId]);
  const held = devicesOf(devices, sessionId);
  const selected = held.find((device) => device.id === selectedId) ?? held[0] ?? null;
  const stream = useDevicesStore((s) => (selected ? s.streams[selected.id] : undefined));
  const recording = useDevicesStore((s) =>
    selected && s.recording?.deviceId === selected.id ? s.recording : null
  );
  const statuses = held.map((device) =>
    statusOf(device, device.id === selected?.id ? stream : undefined, device.id === opening)
  );

  useEffect(() => {
    void loadDevices();
  }, []);

  const running =
    !!selected &&
    selected.problems.length === 0 &&
    (selected.state === 'booted' || selected.state === 'connected');
  const live = running && stream?.state === 'live';

  let body: React.ReactNode;
  if (!deviceBridge()) {
    body = (
      <Notice
        icon={AlertTriangle}
        title={t(DEVICES_KEYS.notReady)}
        text={t('The device host is not running in this window. Restart the app and try again.')}
      />
    );
  } else if (!loaded) {
    body = null;
  } else if (error && devices.length === 0) {
    body = (
      <Notice icon={AlertTriangle} title={t(DEVICES_KEYS.failedList)} text={error}>
        <Button variant="outline" size="sm" onClick={() => void loadDevices()}>
          <RefreshCw aria-hidden />
          {t(DEVICES_KEYS.retry)}
        </Button>
      </Notice>
    );
  } else if (opening && !selected) {
    body = <Starting name={devices.find((device) => device.id === opening)?.name ?? null} />;
  } else if (!selected) {
    body = <NoDevice sessionId={sessionId} />;
  } else if (selected.problems.length > 0) {
    body = (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DeviceSetup device={selected} environment={environment} />
      </div>
    );
  } else if (selected.state === 'booting' || opening === selected.id) {
    // The host refuses to stream a device until it has booted.
    body = <Starting name={selected.name} />;
  } else if (selected.state === 'shutdown') {
    body = (
      <Notice
        icon={Power}
        title={t(DEVICES_KEYS.screenShutdown, { name: selected.name })}
        text={t(DEVICES_KEYS.screenShutdownHint)}
      >
        <Button variant="outline" size="sm" onClick={() => void openDevice(sessionId, selected.id)}>
          <Play aria-hidden />
          {t(DEVICES_KEYS.boot)}
        </Button>
      </Notice>
    );
  } else if (selected.state === 'unavailable') {
    body = (
      <Notice
        icon={Unlink}
        title={t(DEVICES_KEYS.screenUnavailable, { name: selected.name })}
        text={t(DEVICES_KEYS.screenUnavailableHint)}
      />
    );
  } else if ((stream?.state === 'error' || stream?.state === 'stopped') && !stream.drawn) {
    body = (
      <Notice
        icon={AlertTriangle}
        title={t(DEVICES_KEYS.screenFailed, { name: selected.name })}
        text={
          stream.error ? (
            <code className="block max-h-24 overflow-auto text-[calc(10rem/14)] break-all">
              {stream.error}
            </code>
          ) : (
            t(DEVICES_KEYS.screenError)
          )
        }
      >
        <Button variant="outline" size="sm" onClick={() => setDeviceStream(selected.id, null)}>
          <RefreshCw aria-hidden />
          {t(DEVICES_KEYS.retry)}
        </Button>
      </Notice>
    );
  } else {
    body = <Stage device={selected} sessionId={sessionId} />;
  }

  return (
    <PaneSheet data-devices-panel="">
      <PaneHead
        tools={
          <>
            <PanelButton
              label={t(DEVICES_KEYS.screenshot)}
              disabled={!live}
              onClick={() => selected && void saveScreenshot(selected, sessionId)}
            >
              <Camera aria-hidden className="size-3.5" />
            </PanelButton>
            {recording ? (
              <>
                <Elapsed since={recording.since} />
                <PanelButton
                  label={t(DEVICES_KEYS.stopRecording)}
                  className="text-destructive hover:text-destructive"
                  onClick={stopRecording}
                >
                  <CircleStop aria-hidden className="size-3.5" />
                </PanelButton>
              </>
            ) : (
              <PanelButton
                label={t(DEVICES_KEYS.record)}
                disabled={!live || !canRecord()}
                onClick={() => selected && startRecording(selected)}
              >
                {/* 未在出流时是空心圆：实心灰点看起来像禁用控件，而不是录音键。 */}
                <Circle aria-hidden className={cn('size-3.5', live && 'fill-current')} />
              </PanelButton>
            )}
            <MoreMenu device={selected} sessionId={sessionId} running={running} />
          </>
        }
      >
        {held.length > 0 ? (
          <div
            role="tablist"
            aria-label={t(DEVICES_KEYS.tabs)}
            className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
          >
            {held.map((device, index) => {
              const chosen = device.id === selected?.id;
              const status = statuses[index];
              const Mark = markOf(device);
              return (
                <span
                  key={device.id}
                  className={cn(
                    'group/tab flex h-6 shrink-0 items-center gap-1 rounded-md pr-0.5 pl-1.5 text-[calc(12rem/14)]',
                    chosen
                      ? 'bg-selection text-selection-foreground'
                      : 'text-muted-foreground hover:bg-accent/60'
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={chosen}
                    title={`${device.name} · ${status ? t(status.label) : t(kindKey(device))}`}
                    onClick={() => selectDevice(sessionId, device.id)}
                    className="flex min-w-0 items-center gap-1 outline-none"
                  >
                    <Mark aria-hidden className="size-3 shrink-0" />
                    <span className="max-w-28 truncate">{device.name}</span>
                    {status && (
                      <State variant={status.variant} dot={status.dot} compact={!chosen}>
                        {t(status.label)}
                      </State>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={t(DEVICES_KEYS.disconnect, { name: device.name })}
                    title={t(DEVICES_KEYS.disconnect, { name: device.name })}
                    onClick={() => void closeDevice(sessionId, device.id)}
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-control hover:text-foreground',
                      !chosen && 'opacity-0 group-hover/tab:opacity-100'
                    )}
                  >
                    <Plus aria-hidden className="size-3 rotate-45" />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <span className="truncate text-[calc(12rem/14)] font-medium">
            {t(DEVICES_KEYS.title)}
          </span>
        )}
        <AddDeviceMenu sessionId={sessionId} open={held.length} />
      </PaneHead>
      <PaneBody>
        <DeviceRequest sessionId={sessionId} />
        {body}
      </PaneBody>
      <DevicePermissions sessionId={sessionId} />
    </PaneSheet>
  );
}

function kindKey(device: DeviceInfo): string {
  if (device.kind === 'physical') return DEVICES_KEYS.kindPhysical;
  return device.platform === 'ios' ? DEVICES_KEYS.kindSimulator : DEVICES_KEYS.kindEmulator;
}

/** A state in the screen's place: an icon, a title, one line and the next step. */
function Notice({
  icon: Icon,
  title,
  text,
  children,
}: {
  icon: Icon;
  title: string;
  text?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <span className="flex size-9 items-center justify-center rounded-[6px] border border-line bg-card text-muted-foreground">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="text-[calc(13rem/14)] font-medium text-foreground">{title}</span>
      {text && (
        <span className="max-w-72 text-[calc(11rem/14)] text-balance text-muted-foreground">
          {text}
        </span>
      )}
      {children}
    </div>
  );
}

function Starting({ name }: { name: string | null }) {
  const { t } = useI18n();
  return (
    <Notice
      icon={MonitorSmartphone}
      title={name ? t(DEVICES_KEYS.starting, { name }) : t(DEVICES_KEYS.opening)}
      text={t(DEVICES_KEYS.openingHint)}
    />
  );
}

/** How long the recording has run, as the red badge before Stop. */
function Elapsed({ since }: { since: number }) {
  const { t } = useI18n();
  const time = clockOf(useSeconds() - since);
  return (
    <Badge
      variant="error"
      role="timer"
      aria-label={t(DEVICES_KEYS.recording, { time })}
      className="mx-0.5 gap-1 tabular-nums"
    >
      <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
      {time}
    </Badge>
  );
}

/** The device on its stage: the screen, and its hardware buttons under it. */
function Stage({ device, sessionId }: { device: DeviceInfo; sessionId: string }) {
  const { t } = useI18n();
  const operator = device.operator;
  const control = operator?.control ?? null;
  const [nudge, setNudge] = useState(0);
  const takeOver = (): void => controlDevice('devices.takeOver', device.id, sessionId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DeviceScreen
        key={device.id}
        device={device}
        sessionId={sessionId}
        control={control}
        agentName={operator?.agentName ?? ''}
        onHeld={() => setNudge((n) => n + 1)}
        onTakeOver={takeOver}
      />
      <div
        role="toolbar"
        aria-label={t(DEVICES_KEYS.hardwareButtons)}
        className="flex shrink-0 items-center justify-center gap-1 border-t border-line/60 px-2 py-1.5"
      >
        {buttonsFor(device.platform).map(({ button, icon: Icon, label }) => (
          <PanelButton
            key={button}
            label={t(label)}
            onClick={() =>
              control?.kind === 'agent'
                ? setNudge((n) => n + 1)
                : void deviceBridge()
                    ?.request('devices.input', {
                      deviceId: device.id,
                      sessionId,
                      input: { type: 'button', button },
                    })
                    .catch(() => undefined)
            }
          >
            <Icon aria-hidden className="size-3.5" />
          </PanelButton>
        ))}
        {nudge > 0 && <span className="sr-only">{t(DEVICES_KEYS.agentUsing)}</span>}
      </div>
    </div>
  );
}

type HardwareButton = 'back' | 'home' | 'recents' | 'lock' | 'volumeDown' | 'volumeUp' | 'rotate';

/** The hardware buttons a platform has, in the order they are drawn. */
function buttonsFor(
  platform: DeviceInfo['platform']
): { button: HardwareButton; icon: Icon; label: string }[] {
  return [
    ...(platform === 'android'
      ? [{ button: 'back' as const, icon: RotateCw, label: DEVICES_KEYS.back }]
      : []),
    { button: 'home', icon: House, label: DEVICES_KEYS.home },
    ...(platform === 'android'
      ? [{ button: 'recents' as const, icon: LayoutGrid, label: DEVICES_KEYS.recents }]
      : []),
    { button: 'lock', icon: Lock, label: DEVICES_KEYS.lock },
    { button: 'volumeDown', icon: Volume1, label: DEVICES_KEYS.volumeDown },
    { button: 'volumeUp', icon: Volume2, label: DEVICES_KEYS.volumeUp },
    { button: 'rotate', icon: RotateCw, label: DEVICES_KEYS.rotate },
  ];
}

/** The devices a session can add, by system: every one of this host it does not hold yet. */
function useAddable(sessionId: string): { title: string; devices: DeviceInfo[] }[] {
  const devices = useDevicesStore((s) => s.devices);
  const others = devices.filter((device) => device.sessionId !== sessionId);
  return [
    { title: 'iOS', devices: others.filter((device) => device.platform === 'ios') },
    { title: 'Android', devices: others.filter((device) => device.platform === 'android') },
  ].filter((group) => group.devices.length > 0);
}

/** What picking a device does, and the state its row ends with. */
function rowOf(device: DeviceInfo): {
  state: 'shutdown' | 'unavailable' | 'plugIn' | 'notAllowed' | 'elsewhere' | null;
  act: (sessionId: string) => Promise<void>;
} {
  if (device.sessionId !== null) {
    return { state: 'elsewhere', act: (sessionId) => moveDevice(sessionId, device.id) };
  }
  const state = device.problems.includes('usb-required')
    ? 'plugIn'
    : device.problems.includes('usb-debugging-unauthorized')
      ? 'notAllowed'
      : device.state === 'shutdown'
        ? 'shutdown'
        : device.state === 'unavailable'
          ? 'unavailable'
          : null;
  return { state, act: (sessionId) => openDevice(sessionId, device.id) };
}

const ROW_LABEL = {
  shutdown: DEVICES_KEYS.rowShutdown,
  unavailable: DEVICES_KEYS.rowUnavailable,
  plugIn: DEVICES_KEYS.rowPlugIn,
  notAllowed: DEVICES_KEYS.rowNotAllowed,
  elsewhere: DEVICES_KEYS.rowElsewhere,
} as const;

/** A row's state as a quiet pill: a dot and words, never the bordered look of a button. */
const ROW_TONE = {
  shutdown: 'bg-muted/70 text-muted-foreground',
  unavailable: 'bg-muted/70 text-muted-foreground',
  plugIn: 'bg-warning/15 text-warning',
  notAllowed: 'bg-warning/15 text-warning',
  elsewhere: 'bg-info/12 text-info',
} as const;

function StatePill({ state }: { state: keyof typeof ROW_TONE }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[calc(10rem/14)]',
        ROW_TONE[state]
      )}
    >
      <span aria-hidden className="size-1 rounded-full bg-current" />
      {t(ROW_LABEL[state])}
    </span>
  );
}

/** What a device runs, in the words people use: "Android 17", not a bare version number. */
function metaOf(device: DeviceInfo, t: (key: string) => string): string {
  const system = device.platform === 'ios' ? 'iOS' : 'Android';
  if (device.osVersion) return `${system} ${device.osVersion}`;
  // A powered-off simulator reports no version; its form is what is left to say.
  if (device.kind === 'emulator') return t(DEVICES_KEYS.kindEmulator);
  if (device.kind === 'simulator') return t(DEVICES_KEYS.kindSimulator);
  return t(DEVICES_KEYS.kindPhysical);
}

/**
 * A device's row, in the empty pane as a card and in the add menu as one line. The whole row is
 * the button that opens, starts or moves the device; its state is a pill, not a control.
 */
function DeviceRow({
  device,
  variant = 'card',
}: {
  device: DeviceInfo;
  variant?: 'card' | 'menu';
}) {
  const { t } = useI18n();
  const { state } = rowOf(device);
  const Mark = markOf(device);
  if (variant === 'menu') {
    return (
      <>
        <Mark aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate" title={device.name}>
          {device.name}
        </span>
        {state && <StatePill state={state} />}
      </>
    );
  }
  return (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground transition-colors group-hover:text-foreground">
        <Mark aria-hidden className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[calc(12rem/14)] font-medium text-foreground">
          {device.name}
        </span>
        <span className="truncate text-[calc(11rem/14)] text-muted-foreground">
          {metaOf(device, t)}
          {state === 'elsewhere' && ` · ${t(DEVICES_KEYS.rowMove)}`}
        </span>
      </span>
      {state && <StatePill state={state} />}
    </>
  );
}

function AddDeviceMenu({ sessionId, open }: { sessionId: string; open: number }) {
  const { t } = useI18n();
  const groups = useAddable(sessionId);
  const full = open >= SESSION_DEVICE_LIMIT;
  return (
    <Menu onOpenChange={(shown) => shown && void loadDevices()}>
      <MenuTrigger
        aria-label={t(DEVICES_KEYS.addDevice)}
        title={t(DEVICES_KEYS.addDevice)}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        <Plus aria-hidden className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-64">
        <div className="px-2 py-1.5 text-[calc(11rem/14)] text-muted-foreground">
          {t(DEVICES_KEYS.addTitle, { open, limit: SESSION_DEVICE_LIMIT })}
        </div>
        {groups.length === 0 && (
          <div className="px-2 py-1.5 text-[calc(11rem/14)] text-muted-foreground">
            {t(DEVICES_KEYS.pickerNone)}
          </div>
        )}
        {groups.map((group, index) => (
          <div key={group.title}>
            {index > 0 && <MenuSeparator />}
            <div className="px-2 py-1 text-[calc(11rem/14)] font-medium text-muted-foreground">
              {group.title}
            </div>
            {group.devices.map((device) => (
              <MenuItem
                key={device.id}
                disabled={full}
                onClick={() => void rowOf(device).act(sessionId)}
              >
                <DeviceRow device={device} variant="menu" />
              </MenuItem>
            ))}
          </div>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function MoreMenu({
  device,
  sessionId,
  running,
}: {
  device: DeviceInfo | null;
  sessionId: string;
  running: boolean;
}) {
  const { t } = useI18n();
  // Undefined until the host answers; null where it cannot tell or set it.
  const [appearance, setAppearance] = useState<DeviceAppearance | null | undefined>(undefined);
  const usable = device !== null;
  const virtual = device !== null && device.kind !== 'physical';
  const api = deviceBridge();

  const read = (): void => {
    if (!usable || !running || !api) {
      setAppearance(null);
      return;
    }
    setAppearance(undefined);
    api
      .request('devices.appearance', { deviceId: device.id, sessionId })
      .then((result) => setAppearance(result.appearance))
      .catch(() => setAppearance(null));
  };
  const choose = (next: DeviceAppearance): void => {
    if (!usable || !api) return;
    const before = appearance;
    setAppearance(next);
    api
      .request('devices.setAppearance', { deviceId: device.id, sessionId, appearance: next })
      .catch(() => setAppearance(before));
  };

  return (
    <Menu onOpenChange={(shown) => shown && read()}>
      <MenuTrigger
        aria-label={t(DEVICES_KEYS.more)}
        title={t(DEVICES_KEYS.more)}
        disabled={!usable}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-popup-open:bg-accent data-popup-open:text-foreground disabled:pointer-events-none disabled:opacity-45"
      >
        <Ellipsis aria-hidden className="size-3.5" />
      </MenuTrigger>
      {usable && (
        <MenuPopup align="end" className="min-w-56">
          <div className="px-2 py-1 text-[calc(11rem/14)] font-medium text-muted-foreground">
            {t(DEVICES_KEYS.appearance)}
          </div>
          <MenuRadioGroup
            value={appearance ?? ''}
            onValueChange={(value) => choose(value as DeviceAppearance)}
          >
            <MenuRadioItem value="light" disabled={!appearance} closeOnClick={false}>
              <Sun aria-hidden />
              {t(DEVICES_KEYS.light)}
            </MenuRadioItem>
            <MenuRadioItem value="dark" disabled={!appearance} closeOnClick={false}>
              <Moon aria-hidden />
              {t(DEVICES_KEYS.dark)}
            </MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem
            className="h-auto items-start py-1.5"
            onClick={() => void closeDevice(sessionId, device.id)}
          >
            <Unlink aria-hidden className="mt-0.5" />
            <span className="flex min-w-0 flex-col">
              <span>{t(DEVICES_KEYS.disconnectItem)}</span>
              <span className="text-[calc(11rem/14)] text-muted-foreground">
                {device.bootedByHost
                  ? t(DEVICES_KEYS.disconnectShutsDown)
                  : virtual
                    ? t(DEVICES_KEYS.disconnectStaysOn)
                    : t(DEVICES_KEYS.disconnectStaysConnected)}
              </span>
            </span>
          </MenuItem>
          {virtual && (
            <MenuItem
              variant="destructive"
              disabled={device.state === 'shutdown'}
              onClick={() => void shutDownDevice(sessionId, device.id)}
            >
              <Power aria-hidden />
              {t(DEVICES_KEYS.shutDown)}
            </MenuItem>
          )}
        </MenuPopup>
      )}
    </Menu>
  );
}

/** One device as a card: the whole row opens, starts or moves it. */
function DeviceCard({ device, sessionId }: { device: DeviceInfo; sessionId: string }) {
  return (
    <button
      type="button"
      onClick={() => void rowOf(device).act(sessionId)}
      className="group flex w-full items-center gap-2.5 rounded-lg border border-line/50 bg-card/40 px-2 py-2 text-left outline-none transition-colors hover:border-line hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <DeviceRow device={device} />
    </button>
  );
}

/** With nothing open yet, the pane lists what can be opened, as the add menu does. */
function NoDevice({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const environment = useDevicesStore((s) => s.environment);
  const groups = useAddable(sessionId);
  // A Mac without Xcode, or a computer with neither system's tools, keeps its setup at hand.
  const setUp =
    environment !== null &&
    !environment.ios &&
    (environment.platform === 'darwin' || !environment.android);
  if (!setUp && groups.length === 0) {
    return (
      <Notice
        icon={Smartphone}
        title={t(DEVICES_KEYS.pickerNone)}
        text={t(DEVICES_KEYS.pickerNoneHint)}
      />
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* The devices that can run are the thing seen first; setup is the footnote under them. */}
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[calc(13rem/14)] font-medium text-foreground">
            {t(DEVICES_KEYS.pickerTitle)}
          </h2>
          <p className="text-[calc(11rem/14)] text-muted-foreground">
            {t(DEVICES_KEYS.pickerHint)}
          </p>
        </div>
        {groups.length === 0 ? (
          <p className="px-1 text-[calc(11rem/14)] text-muted-foreground">
            {t(DEVICES_KEYS.pickerNoneHint)}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <section key={group.title} className="flex flex-col gap-1.5">
                <h3 className="flex items-baseline gap-1.5 px-1 text-[calc(11rem/14)] font-medium text-muted-foreground">
                  {group.title}
                  <span className="text-[calc(10rem/14)] tabular-nums opacity-60">
                    {group.devices.length}
                  </span>
                </h3>
                <div className="flex flex-col gap-1">
                  {group.devices.map((device) => (
                    <DeviceCard key={device.id} device={device} sessionId={sessionId} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        {setUp && environment && <HostSetupPanel environment={environment} />}
      </div>
    </div>
  );
}

/** The pane's words outside React, for a store's toast. */
export { devicesText };

export default DevicesPane;
