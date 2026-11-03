import type { ReactNode } from 'react';

/** Classes belong to descendants, never the @scope marker itself. */
export function DesignRoot({ children }: { children: ReactNode }) {
  return (
    <div data-vetta-plugin-root="vetta-ui-design" style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
