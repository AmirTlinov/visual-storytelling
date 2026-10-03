import { SimulationPlayer } from '../story/simulation.js';
import type { PhysicsRuntime } from './runtime.js';

/** Physics uses the library's player, visibility policy, and single animation clock. */
function mount(element: HTMLElement, world: PhysicsRuntime) {
  let last = 0;
  const player = SimulationPlayer.mount(element, {
    prepare() {
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
      canStep: !world.disposed,
    }),
    render() {},
    commit() {},
  });
  const stopWake = world.onWake(player.play);
  const stopDispose = world.onDispose(dispose);
  const initial = world.snapshot();
  const disposePlayer = player.dispose;
  function dispose() {
    stopWake();
    stopDispose();
    disposePlayer();
  }
  return Object.assign(player, {
    reset() {
      player.pause(false);
      world.restore(initial);
      player.update();
    },
    dispose,
  });
}
export const PhysicsPlayer = { mount };
