import { releaseResources } from '../lifecycle.js';
import type { PhysicsRuntime } from './runtime.js';

/** A body owns its native state, view bindings, and active interactions in either dimension. */
export function bodyLifetime(
  world: PhysicsRuntime,
  id: string,
  native: { awake(): boolean; remove(): void },
) {
  let disposed = false,
    disposing = false;
  const listeners = new Set<() => void>();
  function assertLive() {
    if (disposed || world.disposed) throw new Error(`Physical body was removed: ${id}`);
  }
  function dispose() {
    if (disposed || disposing) return;
    disposing = true;
    const resources = [
      ...listeners,
      () => {
        try {
          native.remove();
        } finally {
          disposed = true;
        }
      },
      untrack,
      () => world.sync(),
    ];
    listeners.clear();
    try {
      releaseResources(resources, `Physical body ${id} disposal failed.`);
    } finally {
      disposed = true;
      disposing = false;
    }
  }
  const untrack = world.track(id, { awake: native.awake, dispose });
  return {
    assertLive,
    get disposed() {
      return disposed;
    },
    onDispose(cleanup: () => void) {
      assertLive();
      listeners.add(cleanup);
      return () => {
        listeners.delete(cleanup);
      };
    },
    dispose,
  };
}
