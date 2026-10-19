const DENY_PREFIX = [
  'Input.',
  'Browser.',
  'Storage.',
  'SystemInfo.',
  'Target.',
  'Tethering.',
  'PWA.',
  'Cast.',
  'Inspector.',
];

const DENY_EXACT = new Set([
  'Network.setCookie',
  'Network.setCookies',
  'Network.getCookies',
  'Network.getAllCookies',
  'Network.setUserAgentOverride',
  'Network.deleteCookies',
  'Network.clearBrowserCookies',
  'Network.clearBrowserCache',
  'Page.navigate',
  'Page.reload',
  'Page.navigateToHistoryEntry',
  'Page.setDownloadBehavior',
  'DOM.setFileInputFiles',
]);

/** Retains page debugging; browser state and managed automation use dedicated operations. */
export function assertAllowedCdpMethod(method: string): void {
  const name = method.trim();
  if (!name || !/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(`Invalid CDP method: ${method}`);
  }
  if (
    DENY_EXACT.has(name) ||
    DENY_PREFIX.some((prefix) => name.startsWith(prefix)) ||
    /^Emulation\.(?:set|clear|reset|add|remove|enable|disable)/.test(name)
  ) {
    throw new Error(
      `CDP method ${name} is not allowed. Use dedicated browser tools for input, navigation, device settings, downloads and tab control. Direct cookie, Storage and Browser access is denied; page debugging remains available.`
    );
  }
}
