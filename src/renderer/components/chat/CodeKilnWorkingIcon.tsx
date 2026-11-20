import type { BusyPhase } from './busyStatus';

export type WorkingIconPhase = BusyPhase | 'loading';

/**
 * Kinetic Enso orbital beacon in the 22px running-status footprint:
 * a quiet track ring, a sweeping brand comet arc, and a breathing ember core.
 */
export function CodeKilnWorkingIcon({ phase = 'working' }: { phase?: WorkingIconPhase }) {
  return (
    <span
      role="img"
      aria-label="CodeKiln"
      data-phase={phase}
      className="codekiln-working-icon relative inline-flex size-[calc(22rem/14)] shrink-0 items-center justify-center"
    >
      <svg
        viewBox="0 0 22 22"
        aria-hidden="true"
        className="codekiln-working-svg size-full overflow-visible"
      >
        <circle cx="11" cy="11" r="7.75" className="codekiln-working-track" />
        <g className="codekiln-working-orbit">
          <circle cx="11" cy="11" r="7.75" className="codekiln-working-arc-tail" />
          <circle cx="11" cy="11" r="7.75" className="codekiln-working-arc-head" />
        </g>
        <circle cx="11" cy="11" r="4" className="codekiln-working-halo" />
        <circle cx="11" cy="11" r="2.1" className="codekiln-working-core" />
      </svg>
    </span>
  );
}
