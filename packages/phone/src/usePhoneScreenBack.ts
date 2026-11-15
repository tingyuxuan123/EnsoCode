import { useState } from 'react';
import { usePhoneBack } from './usePhoneBack';

/** A conversation is below its dialogs but above the launch/root list.
 * A list opened by Back is the root: another Back may leave. A list opened
 * by its toolbar button can instead return to the current conversation.
 * Only this presentation state lives here; history never contains session data.
 */
export function usePhoneScreenBack(options: {
  enabled: boolean;
  docked: boolean;
  initialListOpen: boolean;
}) {
  const [screen, setScreen] = useState<'conversation' | 'returnable-list' | 'root-list'>(
    options.initialListOpen ? 'root-list' : 'conversation'
  );
  usePhoneBack(
    options.enabled && !options.docked && screen === 'conversation',
    () => setScreen('root-list'),
    0
  );
  return {
    drawerOpen: screen !== 'conversation',
    backToConversation: screen === 'returnable-list',
    openDrawer: () => setScreen('returnable-list'),
    closeDrawer: () => setScreen('conversation'),
  };
}
