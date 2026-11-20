import { useId } from 'react';
import type { BusyPhase } from './busyStatus';

export type WorkingIconPhase = BusyPhase | 'loading';

function roundCoord(value: number): number {
  return Number(value.toFixed(2));
}

/** Builds a symmetric upward-pointing teardrop petal path rooted at (0, 0). */
function petalPath(length: number, bulb: number, neck: number): string {
  const c = length - bulb;
  const y1 = roundCoord(-c * 0.44);
  const y2 = roundCoord(-c * 0.72);
  const negC = roundCoord(-c);
  const b = roundCoord(bulb);
  const n = roundCoord(neck);
  return `M 0 0 C ${-n} ${y1} ${-b} ${y2} ${-b} ${negC} A ${b} ${b} 0 0 1 ${b} ${negC} C ${b} ${y2} ${n} ${y1} 0 0 Z`;
}

const PRIMARY_PETAL_D = petalPath(9.4, 2.05, 0.48);
const SECONDARY_PETAL_D = petalPath(8.85, 1.72, 0.4);

const PRIMARY_ANGLES = [0, 120, 240] as const;
const SECONDARY_ANGLES = [60, 180, 300] as const;
const SPARK_RAYS = [30, 90, 150, 210, 270, 330].map((deg) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return {
    deg,
    x1: roundCoord(Math.cos(rad) * 7.4),
    y1: roundCoord(Math.sin(rad) * 7.4),
    x2: roundCoord(Math.cos(rad) * 9.5),
    y2: roundCoord(Math.sin(rad) * 9.5),
  };
});

/**
 * Fluid kinetic star-bloom centered in the 22px timeline icon track:
 * an ambient ember aura, two counter-unfurling interleaved 3-petal triads,
 * peak-bloom micro-sparks, and a luminous breathing seed core.
 * Driven purely by GPU-composited CSS animations (zero React re-renders).
 */
export function CodeKilnWorkingIcon({ phase = 'working' }: { phase?: WorkingIconPhase }) {
  const glowId = `codekiln-spark-glow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <span
      role="img"
      aria-label="CodeKiln"
      data-phase={phase}
      className="codekiln-working-icon relative inline-flex size-[calc(22rem/14)] shrink-0 items-center justify-center text-brand"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="codekiln-spark-svg codekiln-spark-rotor size-[calc(16rem/14)] overflow-visible"
      >
        <defs>
          <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
            <stop offset="52%" stopColor="currentColor" stopOpacity="0.11" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g className="codekiln-spark-aura">
          <circle cx="12" cy="12" r="11.2" fill={`url(#${glowId})`} />
        </g>

        <g className="codekiln-spark-triad-secondary">
          <g transform="translate(12 12)">
            {SECONDARY_ANGLES.map((deg) => (
              <path
                key={deg}
                d={SECONDARY_PETAL_D}
                fill="currentColor"
                transform={`rotate(${deg})`}
              />
            ))}
          </g>
        </g>

        <g className="codekiln-spark-triad-primary">
          <g transform="translate(12 12)">
            {PRIMARY_ANGLES.map((deg) => (
              <path
                key={deg}
                d={PRIMARY_PETAL_D}
                fill="currentColor"
                transform={deg ? `rotate(${deg})` : undefined}
              />
            ))}
          </g>
        </g>

        <g className="codekiln-spark-rays">
          <g transform="translate(12 12)">
            {SPARK_RAYS.map((ray) => (
              <line
                key={ray.deg}
                x1={ray.x1}
                y1={ray.y1}
                x2={ray.x2}
                y2={ray.y2}
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
              />
            ))}
          </g>
        </g>

        <g className="codekiln-spark-core">
          <circle cx="12" cy="12" r="2.7" fill="currentColor" />
          <circle
            cx="12"
            cy="12"
            r="1.0"
            fill="var(--brand-foreground)"
            className="codekiln-spark-glint"
          />
        </g>
      </svg>
    </span>
  );
}
