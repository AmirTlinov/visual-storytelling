/** Pigments are shared by objects, lettering and controls. Only washes use opacity. */
export const pigments = {
  ink: ['#30302E', '#E8E3DA'],
  blue: ['#2B5DA8', '#91B9EE'],
  ochre: ['#AA6429', '#E4B173'],
  purple: ['#76559B', '#C3A3DF'],
  green: ['#357052', '#90C6A4'],
  red: ['#AE4548', '#E79B9A'],
  straw: ['#E4C665', '#DCC26D'],
} as const;
export type Pigment = keyof typeof pigments;
export type Theme = 'auto' | 'light' | 'dark';
export const color = (pigment: Pigment) => `var(--vs-${pigment})`;

export function theme(root: HTMLElement | SVGElement, initial: Theme = 'auto') {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let selection = initial;
  const update = () => {
    const dark = selection === 'dark' || (selection === 'auto' && media.matches);
    for (const [name, pair] of Object.entries(pigments))
      root.style.setProperty(`--vs-${name}`, pair[dark ? 1 : 0]);
    root.style.setProperty('--vs-marker-opacity', dark ? '.23' : '.20');
    root.style.setProperty('--vs-grid-opacity', dark ? '.13' : '.11');
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.dataset.theme = dark ? 'dark' : 'light';
  };
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
