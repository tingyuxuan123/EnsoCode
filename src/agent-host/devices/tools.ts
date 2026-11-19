// The `device_*` tools: an agent lists, opens and drives the mobile devices of its host.
//
// Kettu's agent host ran these in Main; CodeKiln's runs in the agent worker, so this file keeps only
// what is safe there: the tool declarations, the argument checks and the action they build. The
// session, the agent's name, the project folder and the user's permission are Main's to decide —
// see `main.ts`, which answers every call. Nothing here trusts the model for any of them.

import type { DeviceToolName } from '@shared/device-agent';
import { DeviceArgsError, type DeviceToolAnswer, deviceRequestOf } from '@shared/device-tools';

type Schema = Record<string, unknown>;

/** One device tool as this build declares it: what the model reads, and what the worker checks. */
export interface DeviceToolSpec {
  name: DeviceToolName;
  title: string;
  description: string;
  parameters: Schema;
  readOnly: boolean;
}

function object(properties: Record<string, Schema>, required: string[] = []): Schema {
  return { type: 'object', properties, required, additionalProperties: false };
}

const DEVICE_ID: Schema = {
  type: 'string',
  description: 'The device id that device_list gives, such as ios-sim:<udid> or android:<serial>.',
};
const REF: Schema = {
  type: 'string',
  description: 'An element reference from the latest device_snapshot, such as @e3.',
};

export const DEVICE_TOOLS: DeviceToolSpec[] = [
  {
    name: 'device_list',
    title: 'List mobile devices',
    description:
      'Lists the iOS simulators, Android emulators and connected phones on this host, with their ids, state and anything they still need.',
    parameters: object({}),
    readOnly: true,
  },
  {
    name: 'device_open',
    title: 'Open a mobile device',
    description:
      'Opens a device for this session and shows it beside the conversation; a shut-down simulator or emulator boots first. Asks the user the first time.',
    parameters: object({ deviceId: DEVICE_ID }, ['deviceId']),
    readOnly: false,
  },
  {
    name: 'device_close',
    title: 'Close a mobile device',
    description:
      'Lets go of a device this session opened. `shutdown` also shuts a simulator or emulator down.',
    parameters: object({ deviceId: DEVICE_ID, shutdown: { type: 'boolean', default: false } }, [
      'deviceId',
    ]),
    readOnly: false,
  },
  {
    name: 'device_snapshot',
    title: 'Read the device screen',
    description:
      'The accessibility tree of what the device shows, each actionable element with a reference such as @e3. References change after the screen changes; read again then.',
    parameters: object({ deviceId: DEVICE_ID }, ['deviceId']),
    readOnly: true,
  },
  {
    name: 'device_tap',
    title: 'Tap on the device',
    description:
      'Taps an element by reference, or a point in device points when no element fits. `long` holds it. Returns the screen changes once they settle.',
    parameters: object(
      {
        deviceId: DEVICE_ID,
        ref: REF,
        x: { type: 'number', minimum: 0 },
        y: { type: 'number', minimum: 0 },
        long: { type: 'boolean', default: false },
      },
      ['deviceId']
    ),
    readOnly: false,
  },
  {
    name: 'device_fill',
    title: 'Fill a field on the device',
    description: 'Replaces the text of an input element.',
    parameters: object({ deviceId: DEVICE_ID, ref: REF, text: { type: 'string' } }, [
      'deviceId',
      'ref',
      'text',
    ]),
    readOnly: false,
  },
  {
    name: 'device_type',
    title: 'Type on the device',
    description: 'Types text into the focused field, after what it holds.',
    parameters: object({ deviceId: DEVICE_ID, text: { type: 'string' } }, ['deviceId', 'text']),
    readOnly: false,
  },
  {
    name: 'device_scroll',
    title: 'Scroll on the device',
    description: 'Scrolls the screen one page in a direction.',
    parameters: object(
      { deviceId: DEVICE_ID, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] } },
      ['deviceId', 'direction']
    ),
    readOnly: false,
  },
  {
    name: 'device_swipe',
    title: 'Swipe on the device',
    description: 'Drags a finger from one point to another, in device points.',
    parameters: object(
      {
        deviceId: DEVICE_ID,
        fromX: { type: 'number', minimum: 0 },
        fromY: { type: 'number', minimum: 0 },
        toX: { type: 'number', minimum: 0 },
        toY: { type: 'number', minimum: 0 },
      },
      ['deviceId', 'fromX', 'fromY', 'toX', 'toY']
    ),
    readOnly: false,
  },
  {
    name: 'device_press_button',
    title: 'Press a device button',
    description:
      'Presses a hardware or system button: home, back (Android), recents, lock, volumeUp or volumeDown.',
    parameters: object(
      {
        deviceId: DEVICE_ID,
        button: {
          type: 'string',
          enum: ['home', 'back', 'recents', 'lock', 'volumeUp', 'volumeDown'],
        },
      },
      ['deviceId', 'button']
    ),
    readOnly: false,
  },
  {
    name: 'device_rotate',
    title: 'Rotate the device',
    description: 'Sets the orientation.',
    parameters: object(
      {
        deviceId: DEVICE_ID,
        orientation: {
          type: 'string',
          enum: ['portrait', 'portrait_upside_down', 'landscape_left', 'landscape_right'],
        },
      },
      ['deviceId', 'orientation']
    ),
    readOnly: false,
  },
  {
    name: 'device_screenshot',
    title: 'Take a device screenshot',
    description: 'A picture of the screen. Prefer device_snapshot to find what to tap.',
    parameters: object({ deviceId: DEVICE_ID }, ['deviceId']),
    readOnly: true,
  },
  {
    name: 'device_install_app',
    title: 'Install an app on the device',
    description:
      'Installs an app the project built: a .app for a simulator, an .ipa for an iPhone, an .apk for Android. Build it with the project’s own commands first.',
    parameters: object({ deviceId: DEVICE_ID, path: { type: 'string' } }, ['deviceId', 'path']),
    readOnly: false,
  },
  {
    name: 'device_launch_app',
    title: 'Launch an app on the device',
    description:
      'Launches an installed app by bundle id or Android package, restarting it if it runs, and follows it for later snapshots and logs.',
    parameters: object({ deviceId: DEVICE_ID, app: { type: 'string' } }, ['deviceId', 'app']),
    readOnly: false,
  },
  {
    name: 'device_terminate_app',
    title: 'Quit an app on the device',
    description: 'Stops a running app by bundle id or Android package.',
    parameters: object({ deviceId: DEVICE_ID, app: { type: 'string' } }, ['deviceId', 'app']),
    readOnly: false,
  },
  {
    name: 'device_open_url',
    title: 'Open a URL on the device',
    description: 'Opens a web address or a deep link, which the app registered for it handles.',
    parameters: object({ deviceId: DEVICE_ID, url: { type: 'string' } }, ['deviceId', 'url']),
    readOnly: false,
  },
  {
    name: 'device_logs',
    title: 'Read device logs',
    description: 'The latest log lines of the app open in this session.',
    parameters: object(
      { deviceId: DEVICE_ID, lines: { type: 'integer', minimum: 1, maximum: 2000, default: 200 } },
      ['deviceId']
    ),
    readOnly: true,
  },
  {
    name: 'device_set_appearance',
    title: 'Set light or dark mode',
    description: 'Switches the device between light and dark appearance.',
    parameters: object({ deviceId: DEVICE_ID, mode: { type: 'string', enum: ['light', 'dark'] } }, [
      'deviceId',
      'mode',
    ]),
    readOnly: false,
  },
  {
    name: 'device_set_location',
    title: 'Set the device location',
    description: 'Moves a simulator or emulator to a coordinate.',
    parameters: object(
      {
        deviceId: DEVICE_ID,
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
      },
      ['deviceId', 'latitude', 'longitude']
    ),
    readOnly: false,
  },
  {
    name: 'device_set_permission',
    title: 'Grant or deny an app permission',
    description:
      'Grants or denies a permission, such as camera, photos, location or notifications, to an app.',
    parameters: object(
      {
        deviceId: DEVICE_ID,
        app: { type: 'string' },
        permission: {
          type: 'string',
          enum: [
            'camera',
            'microphone',
            'photos',
            'contacts',
            'notifications',
            'calendar',
            'location',
            'reminders',
          ],
        },
        grant: { type: 'boolean' },
      },
      ['deviceId', 'app', 'permission', 'grant']
    ),
    readOnly: false,
  },
];

export function isDeviceToolName(name: string): name is DeviceToolName {
  return DEVICE_TOOLS.some((tool) => tool.name === name);
}

export function deviceToolSpec(name: string): DeviceToolSpec | undefined {
  return DEVICE_TOOLS.find((tool) => tool.name === name);
}

/**
 * The worker's side of the tools: it checks the arguments, builds the call and forwards it, and
 * turns Main's answer into what the model reads. It never decides whether the session may use a
 * device — Main answers `not_allowed` when it may not.
 */
export class DeviceTools {
  constructor(
    private readonly call: (
      toolName: string,
      args: unknown,
      signal?: AbortSignal
    ) => Promise<DeviceToolAnswer>
  ) {}

  async invoke(name: string, input: unknown, signal?: AbortSignal): Promise<DeviceToolAnswer> {
    if (!isDeviceToolName(name)) throw new Error(`Unknown tool ${name}`);
    try {
      // The worker checks the arguments and would forward them; Main derives the same request from
      // them again, so neither side trusts the other's copy.
      deviceRequestOf(name, input);
      return await this.call(name, input, signal);
    } catch (error) {
      if (error instanceof DeviceArgsError)
        return { error: { code: 'invalid_params', message: error.message } };
      throw error;
    }
  }
}

export type { DeviceArgsError, DeviceToolAnswer };
