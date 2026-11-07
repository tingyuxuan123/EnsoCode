import { useId } from 'react';

/** 小尺寸雨帘：檐口静止，两侧雨丝错峰下落，中间一滴使用当前品牌色。 */
export function EavesWorkingIcon() {
  const id = useId();
  const fadeId = `${id}-fade`;
  const rainId = `${id}-rain`;
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label="Eaves · 檐下"
      className="size-[calc(22rem/14)] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.15" />
          <stop offset="0.12" stopColor="white" />
          <stop offset="0.82" stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0.15" />
        </linearGradient>
        <mask id={rainId} maskUnits="userSpaceOnUse" x="0" y="42" width="100" height="48">
          <rect x="0" y="42" width="100" height="48" fill={`url(#${fadeId})`} stroke="none" />
        </mask>
      </defs>
      <path d="M10 22 Q14 31 25 32 L75 32 Q86 31 90 22" strokeWidth="11" />
      <g mask={`url(#${rainId})`} strokeWidth="9">
        <path
          className="animate-eaves-rain-left motion-reduce:animate-none"
          d="M28 30 V100"
          strokeDasharray="12 15"
        />
        <path
          className="animate-eaves-rain-right motion-reduce:animate-none"
          d="M72 30 V100"
          strokeDasharray="16 13"
        />
      </g>
      <circle
        className="fill-brand animate-eaves-drop motion-reduce:animate-none [transform-box:fill-box] origin-center"
        cx="50"
        cy="66"
        r="8"
        stroke="none"
      />
    </svg>
  );
}
