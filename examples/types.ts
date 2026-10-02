import type { Theme } from '@visual-storytelling/core';
export interface Example {
  duration: number;
  checkpoints: readonly number[];
  audioURL?: string;
  seek(time: number): void;
  pause(): void;
  setTheme(value: Theme): void;
  setReduced(value: boolean): void;
  svg(): SVGSVGElement;
  snapshot(): unknown;
  exportSVG?(): Promise<string>;
  dispose(): void;
}
