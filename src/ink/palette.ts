/** Pigment values and contrast belong to styles/ink.css. */
export const pigments = {
  ink: 'ink',
  blue: 'blue',
  ochre: 'orange',
  purple: 'purple',
  green: 'green',
  red: 'red',
  straw: 'yellow',
} as const;
export type Pigment = keyof typeof pigments;
export type Theme = 'auto' | 'light' | 'dark';
export const color = (pigment: Pigment) => `var(--ve-${pigments[pigment]})`;
export function theme(root: HTMLElement | SVGElement, initial: Theme = 'auto') {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let selection = initial;
  const update = () => {
    const dark = selection === 'dark' || (selection === 'auto' && media.matches);
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.dataset.theme = dark ? 'dark' : 'light';
  };
  root.classList.add('ve-scene');
  media.addEventListener('change', update);
  update();
  return {
    set(value: Theme) {
      selection = value;
      update();
    },
    dispose() {
      media.removeEventListener('change', update);
    },
  };
}
