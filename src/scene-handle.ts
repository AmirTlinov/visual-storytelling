import type { SceneCommand, SceneInspection } from './scene-access.js';
import type { Theme } from './ink/palette.js';
import type { CueReview } from './story/cues.js';
import type { ScenePresentation } from './scene-frame.js';

declare global {
  interface HTMLElement {
    scene?: SceneHandle;
  }
}

/** The shell's single public handle. Rendering-specific capabilities are optional. */
export interface SceneHandle {
  inspect?(): SceneInspection;
  control?(commands: readonly SceneCommand[]): Promise<SceneInspection>;
  find?(query: string): CueReview['cues'];
  focus?(ids: readonly string[]): void;
  readonly duration: number;
  readonly currentTime: number;
  play(): Promise<void>;
  seek(time: number): void;
  pause(): void;
  setReduced(value: boolean): void;
  snapshot(): unknown;
  review(): CueReview;
  /** On-demand frame and clipping evidence, including inspectable canvas artwork. */
  presentation?(): ScenePresentation;
  dispose(): void;
  setTheme?(value: Theme): void;
  svg?(): SVGSVGElement;
  exportSVG?(): Promise<string>;
  checkpoints?: readonly number[];
  audioURL?: string;
}
