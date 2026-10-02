/** Pigments are shared by objects, lettering and controls. Only washes use opacity. */
export const pigments = {
  ink: ['#292724', '#EEECE7'],
  blue: ['#2367B0', '#83B6FF'],
  ochre: ['#B85516', '#F6AD62'],
  purple: ['#8050B5', '#C2A0FF'],
  green: ['#26794E', '#78CCA4'],
  red: ['#B33F58', '#F294A7'],
  straw: ['#927013', '#DFC066'],
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
    root.style.setProperty('--vs-ink', `var(--foreground,${pigments.ink[dark ? 1 : 0]})`);
    root.style.setProperty('--vs-surface', 'var(--background,Canvas)');
    root.style.setProperty('--vs-pencil', 'color-mix(in srgb,var(--vs-ink) 62%,var(--vs-surface))');
    root.style.setProperty('--vs-grid-opacity', '.14');
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
