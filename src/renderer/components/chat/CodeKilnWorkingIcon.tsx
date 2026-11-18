import type { CSSProperties } from 'react';

const DOTS = Array.from({ length: 9 }, (_, index) => index);

/** Nine-dot working indicator in the existing running-status footprint. */
export function CodeKilnWorkingIcon() {
  return (
    <span
      role="img"
      aria-label="CodeKiln"
      className="codekiln-working-dots size-[calc(22rem/14)] shrink-0"
    >
      {DOTS.map((dot) => (
        <i
          key={dot}
          aria-hidden="true"
          className="codekiln-working-dot"
          style={{ '--working-dot-index': dot } as CSSProperties}
        />
      ))}
    </span>
  );
}
