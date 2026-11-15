import { useEffect, useRef } from 'react';
import { createPhoneBackStack } from './phoneBackStack';

let navigation: ReturnType<typeof createPhoneBackStack> | undefined;

function backStack() {
  navigation ??= createPhoneBackStack({
    state: () => window.history.state,
    push: (state) => window.history.pushState(state, ''),
    back: () => window.history.back(),
    listen: (listener) => {
      const onPop = (event: PopStateEvent) => listener(event.state);
      window.addEventListener('popstate', onPop);
      return () => window.removeEventListener('popstate', onPop);
    },
    defer: (callback) => queueMicrotask(callback),
  });
  return navigation;
}

/** Higher ranks close first: list 10, subpage 20–30, menu 40, sheet 50–60, image 70. */
export function usePhoneBack(active: boolean, onBack: () => void, rank: number) {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!active) return;
    return backStack().add(() => latest.current(), rank);
  }, [active, rank]);
}
