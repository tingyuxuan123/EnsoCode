// What a device still needs before it can be shown, with what is done already checked off. Each
// unfinished step links to the vendor's own instructions; CodeKiln installs none of it.

import type { DeviceEnvironment, DeviceInfo, DeviceProblem } from '@shared/device-host';
import { Check, ChevronDown, ChevronRight, ExternalLink, X } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  DEVICES_CHECK_DONE,
  DEVICES_CHECK_LABELS,
  DEVICES_CHECK_LINKS,
  DEVICES_CHECK_TODO,
  DEVICES_SETUP_KEYS,
  type DeviceCheckProblem,
} from './i18n';

/** Where the vendor explains a step that is done outside CodeKiln. */
const LINKS: Partial<Record<DeviceCheckProblem, string>> = {
  'xcode-missing': 'https://apps.apple.com/app/xcode/id497799835',
  'android-sdk-missing': 'https://developer.android.com/studio',
  'developer-mode-off':
    'https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device',
  'usb-debugging-unauthorized': 'https://developer.android.com/studio/debug/dev-options',
};

/** The checks the host makes of each kind of device, in the order they are done. */
const DEVICE_CHECKS: Record<DeviceInfo['platform'], DeviceCheckProblem[]> = {
  ios: ['usb-required', 'not-paired', 'developer-mode-off', 'ddi-not-mounted'],
  android: ['offline', 'usb-debugging-unauthorized'],
};

interface SetupTask {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  link?: { label: string; href: string };
}

interface SetupGroup {
  id: string;
  title: string;
  tasks: SetupTask[];
}

function task(check: DeviceCheckProblem, open: DeviceProblem[]): SetupTask {
  const done = !open.includes(check);
  const href = LINKS[check];
  return {
    id: check,
    label: DEVICES_CHECK_LABELS[check],
    detail: done ? DEVICES_CHECK_DONE[check] : DEVICES_CHECK_TODO[check],
    done,
    ...(href && !done ? { link: { label: DEVICES_CHECK_LINKS[check] ?? '', href } } : {}),
  };
}

/** The computer's own part: the tools each system's devices need. */
function hostGroup(environment: DeviceEnvironment): SetupGroup {
  const checks: DeviceCheckProblem[] =
    environment.platform === 'darwin'
      ? ['xcode-missing', 'android-sdk-missing']
      : ['android-sdk-missing'];
  return {
    id: 'host',
    title:
      environment.platform === 'darwin'
        ? DEVICES_SETUP_KEYS.thisMac
        : DEVICES_SETUP_KEYS.thisComputer,
    tasks: checks.map((check) => task(check, environment.problems)),
  };
}

function Task({ entry }: { entry: SetupTask }) {
  const { t } = useI18n();
  return (
    <li className="flex gap-2 px-2 py-1.5">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          entry.done
            ? 'border-success/40 bg-success/12 text-success'
            : 'border-warning/40 bg-warning/12 text-warning'
        )}
      >
        {entry.done ? <Check className="size-2.5" /> : <X className="size-2.5" />}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[calc(12rem/14)] text-foreground">{t(entry.label)}</span>
        <span className="text-[calc(11rem/14)] text-muted-foreground">{t(entry.detail)}</span>
        {entry.link && (
          <a
            href={entry.link.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[calc(11rem/14)] text-brand hover:underline"
          >
            {t(entry.link.label)}
            <ExternalLink aria-hidden className="size-3" />
          </a>
        )}
      </span>
    </li>
  );
}

function Group({ group, defaultOpen = true }: { group: SetupGroup; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const done = group.tasks.filter((entry) => entry.done).length;
  return (
    <section className="rounded-[6px] border border-line">
      <button
        type="button"
        onClick={() => setOpen((now) => !now)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        {open ? (
          <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-[calc(12rem/14)] font-medium">
          {group.title}
        </span>
        <span className="shrink-0 text-[calc(11rem/14)] text-muted-foreground tabular-nums">
          {done}/{group.tasks.length}
        </span>
      </button>
      {open && (
        <ul className="border-t border-line/60 py-1">
          {group.tasks.map((entry) => (
            <Task key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Guide({
  title,
  titleParams,
  description,
  groups,
}: {
  title: string;
  titleParams?: Record<string, string>;
  description: string;
  groups: SetupGroup[];
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[calc(13rem/14)] font-medium text-foreground">
          {t(title, titleParams)}
        </h3>
        <p className="text-[calc(11rem/14)] text-muted-foreground">{t(description)}</p>
      </div>
      {groups.map((group) => (
        <Group key={group.id} group={group} />
      ))}
    </div>
  );
}

/** What a device still needs before it can be shown. */
export function DeviceSetup({
  device,
  environment,
}: {
  device: DeviceInfo;
  environment: DeviceEnvironment | null;
}) {
  const own: SetupGroup = {
    id: 'device',
    title: device.name,
    tasks: DEVICE_CHECKS[device.platform].map((check) => task(check, device.problems)),
  };
  const mine = environment ? hostGroup(environment) : null;
  // Only the tool this device's system needs counts for it.
  const needed: DeviceCheckProblem =
    device.platform === 'ios' ? 'xcode-missing' : 'android-sdk-missing';
  const hostTasks = mine?.tasks.filter((entry) => entry.id === needed) ?? [];
  return (
    <Guide
      title={DEVICES_SETUP_KEYS.deviceTitle}
      titleParams={{ name: device.name }}
      description={DEVICES_SETUP_KEYS.deviceDescription}
      groups={[...(mine && hostTasks.length > 0 ? [{ ...mine, tasks: hostTasks }] : []), own]}
    />
  );
}

/**
 * What this computer needs before it can run any device, as a footnote under the device list: the
 * devices that can run come first, and what the computer still lacks stays folded away.
 */
export function HostSetupPanel({ environment }: { environment: DeviceEnvironment }) {
  const { t } = useI18n();
  const group = hostGroup(environment);
  const missing = group.tasks.some((entry) => !entry.done);
  return (
    <section className="flex flex-col gap-1.5 border-t border-line/60 pt-2">
      <p className="flex items-start gap-1.5 px-1 text-[calc(11rem/14)] leading-[calc(15rem/14)] text-muted-foreground">
        <span
          aria-hidden
          className={cn(
            'mt-1.5 size-1.5 shrink-0 rounded-full',
            missing ? 'bg-warning' : 'bg-success'
          )}
        />
        <span className="min-w-0 text-balance">{t(DEVICES_SETUP_KEYS.hostDescription)}</span>
      </p>
      <Group group={group} defaultOpen={false} />
    </section>
  );
}
