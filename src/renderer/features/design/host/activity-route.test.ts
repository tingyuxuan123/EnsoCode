import { expect, it } from 'vitest';
import {
  resolveDesignActivitySession,
  resolveDesignPromptTarget,
  viewedDesignSessionId,
} from './activity-route';

it('prefers the viewed session, matches exact workspace cwd, and never redirects to an unrelated session', () => {
  const sessions = [
    { id: 'other', cwd: '/w' },
    { id: 'viewed-child', cwd: '/w' },
    { id: 'else', cwd: '/else' },
  ];
  expect(resolveDesignActivitySession(sessions, 'viewed-child', '/w')).toBe('viewed-child');
  expect(resolveDesignActivitySession(sessions, 'else', '/w')).toBe('other');
  expect(resolveDesignActivitySession(sessions, 'viewed-child')).toBe('viewed-child');
  expect(resolveDesignActivitySession(sessions, 'else', '/missing')).toBeNull();
  expect(resolveDesignActivitySession(sessions, null)).toBeNull();
  expect(viewedDesignSessionId({ parent: { activeTabId: 'child' }, child: {} }, 'parent')).toBe(
    'child'
  );
  expect(viewedDesignSessionId({ parent: { activeTabId: 'deleted' } }, 'parent')).toBe('parent');
});

it('never sends a stale canvas action to the newly viewed session', () => {
  expect(resolveDesignPromptTarget('parent', 'old-child', 'parent')).toBeNull();
  expect(resolveDesignPromptTarget('child', 'child', 'parent')).toBe('child');
  expect(resolveDesignPromptTarget('parent', null, 'parent')).toBe('parent');
  expect(resolveDesignPromptTarget(null, null, 'parent')).toBeNull();
});
