import { describe, expect, it } from 'vitest';
import { assertAllowedCdpMethod } from './cdpPolicy';

describe('assertAllowedCdpMethod', () => {
  it('allows debug/read methods', () => {
    for (const method of [
      'Runtime.evaluate',
      'DOM.getDocument',
      'CSS.getComputedStyleForNode',
      'Profiler.start',
      'Performance.getMetrics',
      'Log.enable',
      'Network.enable',
      'Page.captureScreenshot',
      'Emulation.canEmulate',
      'Emulation.getScreenInfos',
    ]) {
      expect(() => assertAllowedCdpMethod(method)).not.toThrow();
    }
  });

  it('denies input, cookies, navigation, and target control', () => {
    for (const method of [
      'Input.dispatchMouseEvent',
      'Input.insertText',
      'Browser.getVersion',
      'Storage.clearDataForOrigin',
      'Network.setCookie',
      'Network.setCookies',
      'Network.getCookies',
      'Network.getAllCookies',
      'Emulation.setDeviceMetricsOverride',
      'Emulation.clearDeviceMetricsOverride',
      'Emulation.setTouchEmulationEnabled',
      'Emulation.setUserAgentOverride',
      'Network.setUserAgentOverride',
      'Browser.setDownloadBehavior',
      'Page.setDownloadBehavior',
      'Storage.getCookies',
      'Network.clearBrowserCookies',
      'Page.navigate',
      'DOM.setFileInputFiles',
      'Target.createTarget',
    ]) {
      expect(() => assertAllowedCdpMethod(method)).toThrow(/not allowed/i);
    }
  });
});
