const AX_API_DISABLED = -25211;
const AX_CANNOT_COMPLETE = -25204;

export function describeAxOutcome(input: {
  trusted: boolean;
  status: number;
  nodeCount: number;
}): string | null {
  if (!input.trusted || input.status === AX_API_DISABLED) {
    return 'AX tcc-denied — grant Accessibility to Eaves, then restart. Do not click traffic lights.';
  }
  if (input.status === AX_CANNOT_COMPLETE) {
    return 'AX timeout — tree walk exceeded 2.5s; retry ax() on Finder/Settings, or use screenshot coordinates.';
  }
  if (input.status !== 0) {
    return `AX error ${input.status} — retry ax() after raise(), or use screenshot coordinates.`;
  }
  if (input.nodeCount === 0) {
    return 'AX ax-empty — this app does not expose accessibility; use screenshot coordinates. click(x,y) uses the latest screenshot pixels.';
  }
  return null;
}

export function describeAxWorkerExited(): string {
  return 'AX worker-exited — retry ax(), or use screenshot coordinates. click(x,y) uses the latest screenshot pixels.';
}
