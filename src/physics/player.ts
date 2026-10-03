import { SimulationPlayer } from '../story/simulation.js';
import type { PhysicsRuntime } from './runtime.js';

const owners = new WeakSet<PhysicsRuntime>();
/** Physics uses the library's player, visibility policy, and single animation clock. */
function mount(element: HTMLElement, world: PhysicsRuntime) {
  if (owners.has(world)) throw new Error('A physics world can have only one player');
  let last = 0;
  let initial = world.snapshot(),
    disposed = false,
    interacting = false,
    resetting = false;
  function baseline() {
    // Structural edits establish the next experiment; an old snapshot cannot restore removed bodies.
    if (initial.revision !== world.revision) initial = world.snapshot();
    return initial;
  }
  const player = SimulationPlayer.mount(element, {
    prepare() {
      if (!interacting) {
        baseline();
        if (world.sleeping) world.restore(initial);
      }
      last = 0;
    },
    advance(elapsed) {
      const delta = (elapsed - last) / 1000;
      last = elapsed;
      return world.advance(delta);
    },
    step: () => world.step(),
    read: () => ({
      value: 0,
      done: world.sleeping,
      stamp: `${world.time.toFixed(1)} с`,
      canStep: !world.disposed && world.size > 0,
    }),
    render() {},
    commit() {},
  });
  const stopWake = world.onWake(() => {
    if (resetting) return;
    // Touching a settled body continues this pose; explicit replay restores the experiment.
    interacting = true;
    try {
      player.play();
    } finally {
      interacting = false;
    }
  });
  const stopDispose = world.onDispose(dispose);
  owners.add(world);
  const disposePlayer = player.dispose;
  function dispose() {
    if (disposed) return;
    disposed = true;
    owners.delete(world);
    stopWake();
    stopDispose();
    disposePlayer();
  }
  return Object.assign(player, {
    reset() {
      if (disposed) return;
      player.pause(false);
      resetting = true;
      try {
        world.restore(baseline());
      } finally {
        resetting = false;
      }
      player.update();
    },
    dispose,
  });
}
export const PhysicsPlayer = { mount };
