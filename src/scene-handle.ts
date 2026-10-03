import type { Theme } from './ink/palette.js';
import type { CueReview } from './story/cues.js';

declare global {
  interface HTMLElement {
    scene?: SceneHandle;
  }
}

/** The shell's single public handle. Rendering-specific capabilities are optional. */
export interface SceneHandle {
  readonly duration: number;
  readonly currentTime: number;
  play(): Promise<void>;
  seek(time: number): void;
  pause(): void;
  setReduced(value: boolean): void;
  snapshot(): unknown;
  review(): CueReview;
  dispose(): void;
  setTheme?(value: Theme): void;
  svg?(): SVGSVGElement;
  exportSVG?(): Promise<string>;
  checkpoints?: readonly number[];
  audioURL?: string;
}
