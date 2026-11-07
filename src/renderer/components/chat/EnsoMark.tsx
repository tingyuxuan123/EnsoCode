import { cn } from '@/lib/utils';

/** Eaves 雨帘；保留组件名以兼容现有引用，本体随 currentColor 着色。 */
export function EnsoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('size-4', className)}
    >
      <path d="M12 23 Q16 31 26 32 L74 32 Q84 31 88 23" strokeWidth="8" />
      <path d="M31 45 V56 M31 64 V72 M50 45 V58 M69 45 V50 M69 58 V76" strokeWidth="6" />
      <circle
        cx="50"
        cy="70"
        r="4.5"
        fill="#2563EB"
        stroke="none"
        className="dark:fill-[#3B82F6]"
      />
    </svg>
  );
}
