interface OwnerContents {
  id: number;
  isDestroyed(): boolean;
  once(event: 'destroyed', listener: () => void): unknown;
}

/** Attach eagerly, including windows created before plugin IPC registration. */
export class PluginOwnerLifetimes {
  private readonly owners = new WeakMap<OwnerContents, AbortController>();
  constructor(private readonly release: (id: number) => void) {}
  attach(contents: OwnerContents): void {
    if (this.owners.has(contents)) return;
    const controller = new AbortController();
    this.owners.set(contents, controller);
    const destroyed = () => {
      controller.abort();
      this.release(contents.id);
    };
    if (contents.isDestroyed()) destroyed();
    else contents.once('destroyed', destroyed);
  }
  signal(contents: OwnerContents): AbortSignal {
    this.attach(contents);
    return this.owners.get(contents)!.signal;
  }
}
