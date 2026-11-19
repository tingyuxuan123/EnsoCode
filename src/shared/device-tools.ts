// An agent's device tool call, as the worker sends it to Main and Main answers it.
//
// The worker checks the model's arguments and builds the action; it never names the session, the
// agent or the project folder it acts for. Main fills those from the authoritative session record,
// so a model cannot reach another session's device by reporting a session id of its own.

import type {
  DeviceAccessAnswer,
  DeviceAction,
  DeviceActionResult,
  DeviceCallErrorCode,
  DeviceToolName,
} from './device-agent';

/** The built-in tool group the device tools belong to: the settings switch and the loadout id. */
export const DEVICE_TOOLS_BUILTIN_ID = 'mobile_devices';

const MAX_ID = 256;
const MAX_TEXT = 4096;
const MAX_NAME = 512;

/** What a tool call asks the device host for, without what only Main may decide. */
export type DeviceToolCallRequest =
  | { kind: 'list' }
  | { kind: 'open'; deviceId: string }
  | { kind: 'close'; deviceId: string; shutdown: boolean }
  | { kind: 'action'; deviceId: string; action: DeviceAction };

export type DeviceToolAnswer =
  | { result: DeviceActionResult & { value?: unknown } }
  | { error: { code: DeviceCallErrorCode | 'not_allowed'; message: string; data?: unknown } };

/** What Main answers when the worker asks whether its session may use a device. */
export type DeviceToolAccessAnswer = DeviceAccessAnswer;

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Text a device command may carry: no control characters, which no device field needs. */
const printable = (value: string): boolean =>
  Array.from(value).every((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code !== 127;
  });

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && printable(value);

const isNumber = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value);

const POINT_MAX = 100_000;
const REF = /^@?e\d+(~s\d+)?$/;
const APP = /^[A-Za-z0-9][\w.-]*$/;
const URL = /^[a-z][a-z0-9+.-]*:\S+$/i;
const INSTALL = /\.(app|ipa|apk)\/?$/i;

const BUTTONS = ['home', 'back', 'recents', 'lock', 'volumeUp', 'volumeDown'] as const;
const ORIENTATIONS = [
  'portrait',
  'portrait_upside_down',
  'landscape_left',
  'landscape_right',
] as const;
const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
const PERMISSIONS = [
  'camera',
  'microphone',
  'photos',
  'contacts',
  'notifications',
  'calendar',
  'location',
  'reminders',
] as const;

const point = (value: Record<string, unknown>, key: string): boolean =>
  isNumber(value[key], 0, POINT_MAX);

/**
 * The action a call carries, or null when it is not one this build sends. Main re-checks every
 * call with this before the device host runs anything.
 */
export function parseDeviceAction(value: unknown): DeviceAction | null {
  if (!record(value) || typeof value.type !== 'string') return null;
  const keys = Object.keys(value);
  const exact = (...allowed: string[]): boolean =>
    keys.length === allowed.length && keys.every((key) => allowed.includes(key));
  switch (value.type) {
    case 'snapshot':
    case 'screenshot':
      return exact('type') ? { type: value.type } : null;
    case 'tap': {
      if (typeof value.ref === 'string') {
        if (!REF.test(value.ref) || value.ref.length > 32) return null;
        if (value.long !== undefined && typeof value.long !== 'boolean') return null;
        return {
          type: 'tap',
          ref: value.ref.startsWith('@') ? value.ref : `@${value.ref}`,
          ...(value.long === true ? { long: true } : {}),
        };
      }
      if (!point(value, 'x') || !point(value, 'y')) return null;
      if (value.long !== undefined && typeof value.long !== 'boolean') return null;
      return {
        type: 'tap',
        x: value.x as number,
        y: value.y as number,
        ...(value.long === true ? { long: true } : {}),
      };
    }
    case 'fill': {
      if (!isText(value.ref, 32) || !REF.test(value.ref)) return null;
      if (!isText(value.text, MAX_TEXT)) return null;
      return {
        type: 'fill',
        ref: value.ref.startsWith('@') ? value.ref : `@${value.ref}`,
        text: value.text,
      };
    }
    case 'type':
      return isText(value.text, MAX_TEXT) ? { type: 'type', text: value.text } : null;
    case 'scroll':
      return oneOf(value.direction, DIRECTIONS)
        ? { type: 'scroll', direction: value.direction }
        : null;
    case 'swipe': {
      if (!point(value, 'fromX') || !point(value, 'fromY')) return null;
      if (!point(value, 'toX') || !point(value, 'toY')) return null;
      return {
        type: 'swipe',
        from: { x: value.fromX as number, y: value.fromY as number },
        to: { x: value.toX as number, y: value.toY as number },
      };
    }
    case 'button':
      return oneOf(value.button, BUTTONS) ? { type: 'button', button: value.button } : null;
    case 'rotate':
      return oneOf(value.orientation, ORIENTATIONS)
        ? { type: 'rotate', orientation: value.orientation }
        : null;
    case 'install':
      return isText(value.path, MAX_TEXT) && INSTALL.test(value.path)
        ? { type: 'install', path: value.path }
        : null;
    case 'launch':
      return isText(value.app, MAX_NAME) && APP.test(value.app)
        ? { type: 'launch', app: value.app }
        : null;
    case 'terminate':
      return isText(value.app, MAX_NAME) && APP.test(value.app)
        ? { type: 'terminate', app: value.app }
        : null;
    case 'open_url':
      return isText(value.url, MAX_TEXT) && URL.test(value.url)
        ? { type: 'open_url', url: value.url }
        : null;
    case 'logs': {
      if (value.lines === undefined) return { type: 'logs', lines: 200 };
      return isNumber(value.lines, 1, 2000) && Number.isInteger(value.lines)
        ? { type: 'logs', lines: value.lines }
        : null;
    }
    case 'appearance':
      return oneOf(value.mode, ['light', 'dark'] as const)
        ? { type: 'appearance', mode: value.mode }
        : null;
    case 'location':
      return isNumber(value.latitude, -90, 90) && isNumber(value.longitude, -180, 180)
        ? {
            type: 'location',
            latitude: value.latitude,
            longitude: value.longitude,
          }
        : null;
    case 'permission':
      return isText(value.app, MAX_NAME) &&
        APP.test(value.app) &&
        oneOf(value.permission, PERMISSIONS) &&
        typeof value.grant === 'boolean'
        ? {
            type: 'permission',
            app: value.app,
            permission: value.permission,
            grant: value.grant,
          }
        : null;
    default:
      return null;
  }
}

/** A call the worker sends, or null when it is not one this build sends. */
export function parseDeviceToolCall(value: unknown): DeviceToolCallRequest | null {
  if (!record(value) || typeof value.kind !== 'string') return null;
  const keys = Object.keys(value);
  const exact = (...allowed: string[]): boolean =>
    keys.length === allowed.length && keys.every((key) => allowed.includes(key));
  switch (value.kind) {
    case 'list':
      return exact('kind') ? { kind: 'list' } : null;
    case 'open':
      return exact('kind', 'deviceId') && isText(value.deviceId, MAX_ID)
        ? { kind: 'open', deviceId: value.deviceId }
        : null;
    case 'close':
      return exact('kind', 'deviceId', 'shutdown') &&
        isText(value.deviceId, MAX_ID) &&
        typeof value.shutdown === 'boolean'
        ? { kind: 'close', deviceId: value.deviceId, shutdown: value.shutdown }
        : null;
    case 'action': {
      if (!exact('kind', 'deviceId', 'action') || !isText(value.deviceId, MAX_ID)) return null;
      const action = parseDeviceAction(value.action);
      return action ? { kind: 'action', deviceId: value.deviceId, action } : null;
    }
    default:
      return null;
  }
}

/** The device tools by the name the model calls them, for the tool group and the settings page. */
export type DeviceToolCallName = DeviceToolName;

export class DeviceArgsError extends Error {}

function text(value: unknown, key: string, max = MAX_TEXT): string {
  if (!isText(value, max)) {
    throw new DeviceArgsError(`"${key}" must be a non-empty string of at most ${max} characters`);
  }
  return value;
}

function bounded(value: unknown, key: string, min: number, max: number): number {
  if (!isNumber(value, min, max)) {
    throw new DeviceArgsError(`"${key}" must be a number from ${min} to ${max}`);
  }
  return value;
}

function pick<T extends string>(value: unknown, key: string, allowed: readonly T[]): T {
  if (!oneOf(value, allowed)) {
    throw new DeviceArgsError(`"${key}" must be one of ${allowed.join(', ')}`);
  }
  return value;
}

/** An app is named by its bundle id or package, never a path or a flag. */
function appId(value: unknown): string {
  const app = text(value, 'app', MAX_NAME);
  if (!APP.test(app)) throw new DeviceArgsError('"app" must be a bundle id or package name');
  return app;
}

/**
 * The action a tool's checked arguments ask for; list, open and close are not actions.
 * The worker builds it and Main builds it again from the same arguments, so neither trusts the
 * other's copy.
 */
export function deviceActionOf(
  tool: DeviceToolName,
  input: Record<string, unknown>
): DeviceAction | null {
  switch (tool) {
    case 'device_snapshot':
      return { type: 'snapshot' };
    case 'device_tap': {
      const long = input.long === true;
      if (typeof input.ref === 'string') {
        if (!REF.test(input.ref) || input.ref.length > 32)
          throw new DeviceArgsError('"ref" must be a reference such as @e3');
        return { type: 'tap', ref: input.ref.startsWith('@') ? input.ref : `@${input.ref}`, long };
      }
      return {
        type: 'tap',
        x: bounded(input.x, 'x', 0, POINT_MAX),
        y: bounded(input.y, 'y', 0, POINT_MAX),
        long,
      };
    }
    case 'device_fill': {
      const ref = text(input.ref, 'ref', 32);
      if (!REF.test(ref)) throw new DeviceArgsError('"ref" must be a reference such as @e3');
      return {
        type: 'fill',
        ref: ref.startsWith('@') ? ref : `@${ref}`,
        text: text(input.text, 'text'),
      };
    }
    case 'device_type':
      return { type: 'type', text: text(input.text, 'text') };
    case 'device_scroll':
      return { type: 'scroll', direction: pick(input.direction, 'direction', DIRECTIONS) };
    case 'device_swipe':
      return {
        type: 'swipe',
        from: {
          x: bounded(input.fromX, 'fromX', 0, POINT_MAX),
          y: bounded(input.fromY, 'fromY', 0, POINT_MAX),
        },
        to: {
          x: bounded(input.toX, 'toX', 0, POINT_MAX),
          y: bounded(input.toY, 'toY', 0, POINT_MAX),
        },
      };
    case 'device_press_button':
      return { type: 'button', button: pick(input.button, 'button', BUTTONS) };
    case 'device_rotate':
      return { type: 'rotate', orientation: pick(input.orientation, 'orientation', ORIENTATIONS) };
    case 'device_screenshot':
      return { type: 'screenshot' };
    case 'device_install_app': {
      const path = text(input.path, 'path');
      if (!INSTALL.test(path)) throw new DeviceArgsError('"path" must be a .app, .ipa or .apk');
      return { type: 'install', path };
    }
    case 'device_launch_app':
      return { type: 'launch', app: appId(input.app) };
    case 'device_terminate_app':
      return { type: 'terminate', app: appId(input.app) };
    case 'device_open_url': {
      const url = text(input.url, 'url');
      // A scheme and something after it: a web address or an app's deep link, never a flag.
      if (!URL.test(url)) throw new DeviceArgsError('"url" must be a URL');
      return { type: 'open_url', url };
    }
    case 'device_logs':
      return {
        type: 'logs',
        lines: input.lines === undefined ? 200 : bounded(input.lines, 'lines', 1, 2000),
      };
    case 'device_set_appearance':
      return { type: 'appearance', mode: pick(input.mode, 'mode', ['light', 'dark'] as const) };
    case 'device_set_location':
      return {
        type: 'location',
        latitude: bounded(input.latitude, 'latitude', -90, 90),
        longitude: bounded(input.longitude, 'longitude', -180, 180),
      };
    case 'device_set_permission':
      return {
        type: 'permission',
        app: appId(input.app),
        permission: pick(input.permission, 'permission', PERMISSIONS),
        grant: input.grant === true,
      };
    default:
      return null;
  }
}

/**
 * The request one tool call makes of the device host, from the tool's name and the model's
 * arguments. Throws `DeviceArgsError` when the arguments cannot name one; both the worker and Main
 * call it, so the two can never disagree about what a call means.
 */
export function deviceRequestOf(toolName: string, input: unknown): DeviceToolCallRequest {
  const given = record(input) ? input : {};
  if (toolName === 'device_list') return { kind: 'list' };
  const deviceId = text(given.deviceId, 'deviceId', MAX_ID);
  if (toolName === 'device_close') {
    return { kind: 'close', deviceId, shutdown: given.shutdown === true };
  }
  if (toolName === 'device_open') return { kind: 'open', deviceId };
  const action = deviceActionOf(toolName as DeviceToolName, given);
  if (!action) throw new DeviceArgsError(`"${toolName}" is not an action on a device`);
  return { kind: 'action', deviceId, action };
}
