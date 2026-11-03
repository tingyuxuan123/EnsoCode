import { createPortal } from 'react-dom';
import { useDesignRegistry } from '../host/registry';
import type { PluginGlobalSlotContribution } from '../vetta/sdk/ui';
import { DesignImagePreview } from './DesignImagePreview';
import { DesignRoot } from './DesignRoot';

export function DesignGlobalSlots() {
  const contributions = useDesignRegistry((state) => state.contributions);
  return createPortal(
    <DesignRoot>
      <DesignImagePreview />
      {contributions
        .filter((item) => item.kind === 'global')
        .map((item) => {
          const { id, component: Slot } = item.value as PluginGlobalSlotContribution;
          return <Slot key={id} />;
        })}
    </DesignRoot>,
    document.body
  );
}
