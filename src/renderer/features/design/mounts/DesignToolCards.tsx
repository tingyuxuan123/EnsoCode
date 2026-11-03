import { Component, type ReactNode, useEffect, useState } from 'react';
import { resolveDesignRoot } from '../host/paths';
import { useDesignRegistry } from '../host/registry';
import type { CardDescriptor, PluginCardRendererContribution } from '../vetta/sdk/ui';
import { DesignRoot } from './DesignRoot';

class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.warn('[design] card failed', error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Outside the collapsed text body so pending skeletons and completed shots stay visible. */
export function DesignToolCards({
  cards,
  pending,
  messageId,
  sessionId,
}: {
  cards: CardDescriptor[];
  pending: boolean;
  messageId: string;
  sessionId: string;
}) {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void resolveDesignRoot({ kind: 'session', sessionId })
      .then(() => {
        if (!disposed) setReady(sessionId);
      })
      .catch((error) => console.warn('[design] card root unavailable', error));
    return () => {
      disposed = true;
    };
  }, [sessionId]);
  const contributions = useDesignRegistry((state) => state.contributions);
  const renderers = contributions
    .filter((item) => item.kind === 'card-renderer')
    .map((item) => item.value as PluginCardRendererContribution);
  if (ready !== sessionId)
    return <div className="h-48 w-24 animate-pulse rounded-lg border border-border bg-muted" />;
  return (
    <DesignRoot>
      {cards.map((descriptor, index) => {
        const renderer = renderers.find((item) => item.type === descriptor.type);
        if (!renderer) return null;
        const Card = renderer.component;
        return (
          <CardBoundary key={descriptor.key ?? `${descriptor.type}:${index}`}>
            <Card
              descriptor={descriptor}
              pending={pending}
              message={{ id: messageId, role: 'assistant', text: '' }}
            />
          </CardBoundary>
        );
      })}
    </DesignRoot>
  );
}
