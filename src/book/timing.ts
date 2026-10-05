/** Shared by the visible book transition and its speech projection. */
export const bookTiming = { introduction: 4.2, turn: 1.1 } as const;

/** The cover clears the camera before the approach; the chapter appears only after arrival. */
export function bookOpening(progress: number) {
  const phase = (start: number, end: number) =>
    Math.max(0, Math.min(1, (progress - start) / (end - start)));
  const ease = (n: number) => n * n * (3 - 2 * n);
  return { cover: ease(phase(0.1, 0.55)), camera: phase(0.32, 0.9), reveal: ease(phase(0.94, 1)) };
}
