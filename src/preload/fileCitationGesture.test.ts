import { afterEach, expect, it, vi } from 'vitest';
import { createFileCitationGestureGate } from './fileCitationGesture';

class FakeElement {
  constructor(
    readonly tagName: string,
    private readonly action: string,
    private readonly key: string
  ) {}
  hasAttribute(name: string) {
    return this.getAttribute(name) !== null;
  }
  getAttribute(name: string) {
    return name === 'data-file-citation-action'
      ? this.action
      : name === 'data-file-citation-key'
        ? this.key
        : null;
  }
}
class FakeMouse {
  button = 0;
  eventPhase = 1;
  constructor(
    readonly isTrusted: boolean,
    private readonly element: FakeElement
  ) {}
  composedPath() {
    return [this.element];
  }
}

afterEach(() => vi.unstubAllGlobals());

function gate() {
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('MouseEvent', FakeMouse);
  const events = new Map<string, (event: FakeMouse) => void>();
  const view = {
    addEventListener: (name: string, fn: (event: FakeMouse) => void) => events.set(name, fn),
  };
  return {
    claim: createFileCitationGestureGate(view as unknown as Window),
    click: events.get('click'),
  };
}

it('only a live trusted event on the matching control is accepted, once', () => {
  const { claim, click } = gate();
  const link = new FakeElement('A', 'open', 'source');
  click?.(new FakeMouse(false, link));
  expect(claim('open', 'source')).toBe(false);
  const genuine = new FakeMouse(true, link);
  click?.(genuine);
  expect(claim('open', 'other')).toBe(false);
  expect(claim('save', 'source')).toBe(false);
  expect(claim('open', 'source')).toBe(true);
  expect(claim('open', 'source')).toBe(false);
  click?.(genuine);
  genuine.eventPhase = Event.NONE;
  expect(claim('open', 'source')).toBe(false);
});

it('an editor click does not authorize saving, but the matching Save button does', () => {
  const { claim, click } = gate();
  click?.(new FakeMouse(true, new FakeElement('TEXTAREA', 'save', 'current-revision')));
  expect(claim('save', 'current-revision')).toBe(false);
  click?.(new FakeMouse(true, new FakeElement('BUTTON', 'save', 'current-revision')));
  expect(claim('save', 'current-revision')).toBe(true);
});
