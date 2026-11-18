import brandLogo from '../../../../build/brand-mark.png';

/** Animated CodeKiln logo in the existing running-status footprint. */
export function CodeKilnWorkingIcon() {
  return (
    <img
      src={brandLogo}
      alt="CodeKiln"
      className="codekiln-working-icon size-[calc(22rem/14)] shrink-0 object-contain"
    />
  );
}
