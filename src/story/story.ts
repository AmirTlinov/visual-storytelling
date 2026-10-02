import { cueSheet, type Frame, type Script } from './cues.js';
import { transport } from './transport.js';

export interface StoryOptions<P, K extends string> {
  script: Script<K>;
  audio?: HTMLAudioElement;
  stateAt(frame: Frame<K>): P;
  render(state: P, frame: Frame<K>, mode: 'story' | 'explore'): void;
}
export function story<P, K extends string>(options: StoryOptions<P, K>) {
  const sheet = cueSheet(options.script);
  const player = transport({ duration: options.script.duration, audio: options.audio });
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let mode: 'story' | 'explore' = 'story',
    values = options.stateAt(sheet.at(0, media.matches));
  let forcedReduced: boolean | undefined;
  const listeners = new Set<(mode: 'story' | 'explore', values: P) => void>();
  function update() {
    const frame = sheet.at(player.state.time, forcedReduced ?? media.matches);
    if (mode === 'story') values = options.stateAt(frame);
    options.render(values, frame, mode);
    for (const listener of listeners) listener(mode, values);
  }
  const unsubscribe = player.subscribe(update);
  media.addEventListener('change', update);
  return {
    player,
    sheet,
    update,
    get values() {
      return values;
    },
    get mode() {
      return mode;
    },
    explore(next: P) {
      player.pause();
      mode = 'explore';
      values = next;
      update();
    },
    resume() {
      mode = 'story';
      update();
    },
    seek(time: number) {
      mode = 'story';
      player.seek(time);
    },
    setReduced(value?: boolean) {
      forcedReduced = value;
      update();
    },
    subscribe(listener: (mode: 'story' | 'explore', values: P) => void) {
      listeners.add(listener);
      listener(mode, values);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribe();
      player.dispose();
      media.removeEventListener('change', update);
      listeners.clear();
    },
  };
}
export type Story<P, K extends string = string> = ReturnType<typeof story<P, K>>;
