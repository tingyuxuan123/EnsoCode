import { cn } from '@/lib/utils';
import { type ProviderLogo, resolveProviderLogo } from './providerLogos';

/**
 * 厂商标的唯一渲染入口：官方 SVG（彩色 `<img>` / 单色 mask）→ 内联 path → 字母。
 * 形态判断在 `resolveProviderLogo` 里，这里只负责画，不要在这里再分叉业务逻辑。
 */
export function ProviderMark({
  id,
  label,
  className,
}: {
  id: string;
  label?: string;
  className?: string;
}) {
  return <ProviderMarkLogo logo={resolveProviderLogo(id, label)} className={className} />;
}

export function ProviderMarkLogo({
  logo,
  className,
}: {
  logo: ProviderLogo | null;
  className?: string;
}) {
  if (!logo) return null;

  if (logo.kind === 'letter') {
    return (
      <span aria-hidden className={cn('font-semibold text-[0.9em] leading-none', className)}>
        {logo.letter}
      </span>
    );
  }

  if (logo.kind === 'mark') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={cn('fill-current', className)}>
        <path d={logo.path} />
      </svg>
    );
  }

  if (logo.appearance === 'monochrome') {
    const mask = `url(${JSON.stringify(logo.src)})`;
    return (
      <span
        aria-hidden
        className={cn('inline-block shrink-0 bg-current', className)}
        style={{
          maskImage: mask,
          maskPosition: 'center',
          maskRepeat: 'no-repeat',
          maskSize: 'contain',
          WebkitMaskImage: mask,
          WebkitMaskPosition: 'center',
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskSize: 'contain',
        }}
      />
    );
  }

  return (
    <img src={logo.src} alt="" aria-hidden className={cn('shrink-0 object-contain', className)} />
  );
}
