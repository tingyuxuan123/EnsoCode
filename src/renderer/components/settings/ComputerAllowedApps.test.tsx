import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ComputerAllowedAppsList } from './ComputerAllowedApps';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled }: { children: React.ReactNode; disabled: boolean }) => (
    <button type="button" disabled={disabled}>
      {children}
    </button>
  ),
}));

describe('ComputerAllowedApps', () => {
  it('lists canonical paths, including different apps with the same bundle id', () => {
    const html = renderToStaticMarkup(
      <ComputerAllowedAppsList
        apps={[
          { bundleId: 'com.test', name: 'App A', path: '/Applications/A.app', grantedAt: 1 },
          { bundleId: 'com.test', name: 'App B', path: '/Applications/B.app', grantedAt: 2 },
        ]}
        onRevoke={() => {}}
      />
    );
    expect(html).toContain('/Applications/A.app');
    expect(html).toContain('/Applications/B.app');
    expect(html.match(/>Revoke</g)).toHaveLength(2);
    expect(html).not.toContain('Allow app');
  });
  it('empty state explains that only first-input confirmation grants access', () => {
    const html = renderToStaticMarkup(<ComputerAllowedAppsList apps={[]} onRevoke={() => {}} />);
    expect(html).toContain('No apps are always allowed yet.');
    expect(html).toContain('Collabra asks you.');
    expect(html).not.toContain('<button');
  });
});
