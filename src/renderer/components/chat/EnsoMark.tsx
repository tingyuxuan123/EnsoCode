import { cn } from '@/lib/utils';
import brandLogo from '../../../../build/brand-mark.png';

/** Collabra 原图；保留组件名以兼容现有引用。 */
export function EnsoMark({ className }: { className?: string }) {
  return (
    <img
      src={brandLogo}
      alt=""
      aria-hidden="true"
      className={cn('size-4 object-contain', className)}
    />
  );
}
