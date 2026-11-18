import brandLogo from '../../../../build/brand-mark.png';

/** Animated Collabra logo in the existing running-status footprint. */
export function EavesWorkingIcon() {
  return (
    <img
      src={brandLogo}
      alt="Collabra"
      className="collabra-working-icon size-[calc(22rem/14)] shrink-0 object-contain"
    />
  );
}
