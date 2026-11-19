// The devices pane's words. Kettu kept them in an i18next `devices` namespace; CodeKiln's
// dictionary is flat and keyed by the English text, so every key here is that English text and
// its Chinese lives in `src/shared/i18n.ts`. `devicesI18nKeys` is what the test walks.

import { normalizeLocale, translate } from '@shared/i18n';

/** The pane's title and tab strip. */
export const DEVICES_KEYS = {
  title: 'Mobile devices',
  tabs: 'Devices',
  addDevice: 'Add device',
  addTitle: 'Add device · {{open}} of {{limit}} open',
  addFull: 'This session already has {{count}} devices open. Disconnect one first.',
  screenshot: 'Take screenshot',
  record: 'Record screen',
  stopRecording: 'Stop screen recording',
  recording: 'Recording, {{time}}',
  saveUnavailable: 'This window cannot save captures',
  emptyRecording: 'The recording held no frames',
  more: 'Device options',
  reconnect: 'Reconnect',
  retry: 'Try again',
  boot: 'Start device',
  disconnect: 'Disconnect {{name}}',
  takeOver: 'Take over',
  handBack: 'Hand back',
  deny: 'Deny',
  allowUntilTurnEnds: 'Until this turn ends',
  alwaysAllow: 'Always allow',
  agentUsing: 'The agent is using this device',
  youUsing: 'You are using this device',
  notReady: 'The device host is not ready',
  hardwareButtons: 'Hardware buttons',
  back: 'Back button',
  home: 'Home button',
  recents: 'Recent apps',
  lock: 'Lock button',
  volumeDown: 'Volume down',
  volumeUp: 'Volume up',
  rotate: 'Rotate',
  side: 'Side button',
  action: 'Action button',
  otherButton: 'Hardware button',
  appearance: 'Appearance',
  light: 'Light',
  dark: 'Dark',
  disconnectItem: 'Disconnect',
  disconnectShutsDown: 'CodeKiln started it, so it shuts down',
  disconnectStaysOn: 'It stays on',
  disconnectStaysConnected: 'It stays connected',
  shutDown: 'Shut down',
  // 行内徽标是状态，不是可点的关机动作：整行按钮在被选中时会启动设备。
  rowShutdown: 'Powered off',
  rowUnavailable: 'Not connected',
  rowPlugIn: 'Plug in',
  rowNotAllowed: 'Not allowed yet',
  rowElsewhere: 'In another session',
  rowMove: 'Move here',
  pickerTitle: 'Open a device',
  pickerHint: 'Simulators that are shut down start when you choose them.',
  pickerNone: 'No devices found',
  pickerNoneHint:
    'Install Xcode for iOS simulators, or the Android SDK for emulators, and connect a phone with a cable.',
  noSession: 'Devices belong to a session. Send a message first.',
  opening: 'Starting the device…',
  openingHint: 'A simulator or emulator can take a minute to boot.',
  starting: 'Starting {{name}}…',
  failedList: 'Couldn’t list the devices',
  screenLabel: 'Screen of {{name}}',
  keyboard: 'Keyboard for {{name}}',
  screenStarting: 'Waiting for the screen…',
  screenStopped: 'CodeKiln stopped getting frames from {{name}}. It still runs.',
  screenError: 'The screen could not be shown.',
  screenForbidden:
    'This device is open in another session, so this session cannot show or control it.',
  screenShutdown: '{{name}} is shut down',
  screenShutdownHint: 'Start it to see and use its screen.',
  screenUnavailable: '{{name}} is not connected',
  screenUnavailableHint: 'Connect it to this computer again.',
  screenFailed: 'Couldn’t show {{name}}',
  screenLimited: 'The picture updates once a second here. Live video needs WebCodecs.',
  screenshotSaved: 'Screenshot saved to Downloads',
  recordingSaved: 'Recording saved to Downloads',
  showItem: 'Show',
  stateShutdown: 'Shut down',
  stateUnavailable: 'Not connected',
  stateNotReady: 'Not ready',
  stateStarting: 'Starting',
  stateLost: 'Picture lost',
  stateError: 'Error',
  kindSimulator: 'Simulator',
  kindEmulator: 'Emulator',
  kindPhysical: 'Physical device',
} as const;

/** The setup guide's checks: what the host and a device still need. */
export const DEVICES_SETUP_KEYS = {
  thisMac: 'This Mac',
  thisComputer: 'This computer',
  deviceTitle: 'Get {{name}} ready',
  deviceDescription: 'CodeKiln checks again as you go.',
  hostDescription:
    'CodeKiln doesn’t install these itself; each step links to the official download.',
  minimize: 'Minimize',
  expand: 'Expand',
} as const;

/** One check of the guide, as `setup.check.<problem>.<part>`. */
export type DeviceCheckProblem =
  | 'xcode-missing'
  | 'android-sdk-missing'
  | 'usb-required'
  | 'not-paired'
  | 'developer-mode-off'
  | 'ddi-not-mounted'
  | 'offline'
  | 'usb-debugging-unauthorized';

export const DEVICES_CHECK_LABELS: Record<DeviceCheckProblem, string> = {
  'xcode-missing': 'Xcode',
  'android-sdk-missing': 'Android SDK',
  'usb-required': 'Connect with a cable',
  'not-paired': 'Trust this computer',
  'developer-mode-off': 'Developer Mode',
  'ddi-not-mounted': 'Developer disk image',
  offline: 'Connection',
  'usb-debugging-unauthorized': 'USB debugging',
};

export const DEVICES_CHECK_TODO: Record<DeviceCheckProblem, string> = {
  'xcode-missing': 'iOS simulators and iPhones need Xcode on this Mac.',
  'android-sdk-missing':
    'Emulators and Android phones need the Android SDK, which comes with Android Studio.',
  'usb-required': 'Plug it into this computer to see and control its screen.',
  'not-paired': 'Unlock the device and tap Trust on its prompt.',
  'developer-mode-off': 'Turn it on in Settings › Privacy & Security › Developer Mode.',
  'ddi-not-mounted': 'CodeKiln mounts it once the device is unlocked; keep it unlocked.',
  offline: 'The phone is offline. Reconnect its cable.',
  'usb-debugging-unauthorized':
    'Unlock the phone and tap Allow on its “Allow USB debugging?” prompt.',
};

export const DEVICES_CHECK_DONE: Record<DeviceCheckProblem, string> = {
  'xcode-missing': 'Xcode is installed.',
  'android-sdk-missing': 'Found, with adb.',
  'usb-required': 'Connected with a cable.',
  'not-paired': 'It trusts this computer.',
  'developer-mode-off': 'On.',
  'ddi-not-mounted': 'Mounted.',
  offline: 'Online.',
  'usb-debugging-unauthorized': 'Allowed for this computer.',
};

/** The two checks that link to the vendor's own steps. */
export const DEVICES_CHECK_LINKS: Partial<Record<DeviceCheckProblem, string>> = {
  'xcode-missing': 'Get Xcode on the App Store',
  'android-sdk-missing': 'Get Android Studio',
  'developer-mode-off': 'Apple’s steps',
  'usb-debugging-unauthorized': 'Android’s steps',
};

/** The keys whose Chinese is the English word: product names, not words to translate. */
export const DEVICES_PROPER_NOUN_KEYS: readonly string[] = ['Xcode', 'Android SDK'];

/** Every flat key the pane uses, for the dictionary test. */
export const devicesI18nKeys: string[] = [
  ...new Set([
    ...Object.values(DEVICES_KEYS),
    ...Object.values(DEVICES_SETUP_KEYS),
    ...Object.values(DEVICES_CHECK_LABELS),
    ...Object.values(DEVICES_CHECK_TODO),
    ...Object.values(DEVICES_CHECK_DONE),
    ...Object.values(DEVICES_CHECK_LINKS),
  ]),
];

/**
 * The pane's words outside React, such as a store's toast. The app writes the chosen language to
 * `<html lang>` when the setting changes, so this needs no store and works in a bare test.
 */
export function devicesText(key: string, params?: Record<string, string | number>): string {
  const lang = typeof document === 'undefined' ? undefined : document.documentElement.lang;
  return translate(normalizeLocale(lang), key, params);
}
