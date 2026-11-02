import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), list: vi.fn(), revoke: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('../services/computerHost', () => ({
  computerHost: { allowedApps: mocks.list, revokeApp: mocks.revoke },
}));
vi.mock('../windows/MainWindow', () => ({ isMainWebContents: (id: number) => id === 2 }));
vi.mock('../windows/SettingsWindow', () => ({ isSettingsWebContents: (id: number) => id === 3 }));

import { registerComputerHandlers } from './computer';

function invoke(channel: string, id: number, value?: unknown) {
  const handler = mocks.handle.mock.calls.find(([key]) => key === channel)?.[1];
  expect(handler).toBeTypeOf('function');
  return handler({ sender: { id } }, value);
}
describe('computer application authorization IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockReturnValue([{ name: 'Target' }]);
    mocks.revoke.mockReturnValue(true);
    registerComputerHandlers();
  });
  it.each([1, 4])(
    'rejects shell and untrusted web contents %s without reading or writing',
    (id) => {
      expect(invoke('computer:allowed-apps', id)).toEqual([]);
      expect(invoke('computer:revoke-app', id, '["com.test","/Applications/App.app"]')).toEqual({
        ok: false,
      });
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.revoke).not.toHaveBeenCalled();
    }
  );
  it.each([2, 3])('permits main/settings UI %s to list and revoke opaque keys', (id) => {
    expect(invoke('computer:allowed-apps', id)).toEqual([{ name: 'Target' }]);
    expect(invoke('computer:revoke-app', id, '["com.test","/Applications/App.app"]')).toEqual({
      ok: true,
    });
    expect(mocks.revoke).toHaveBeenCalledWith('["com.test","/Applications/App.app"]');
  });
  it.each([null, {}, [], 1, '', 'x'.repeat(8193)])(
    'invalid revoke input never reaches storage',
    (value) => {
      expect(invoke('computer:revoke-app', 2, value)).toEqual({ ok: false });
      expect(mocks.revoke).not.toHaveBeenCalled();
    }
  );
  it('storage errors are returned rather than crossing IPC as exceptions', () => {
    mocks.revoke.mockImplementation(() => {
      throw new Error('disk');
    });
    expect(invoke('computer:revoke-app', 2, 'id')).toEqual({ ok: false });
  });
});
