/** Pigment values and contrast belong to styles/ink.css. */
export const pigments = {
  ink: 'ink',
  muted: 'muted',
  blue: 'blue',
  orange: 'orange',
  purple: 'purple',
  green: 'green',
  red: 'red',
  yellow: 'yellow',
} as const;
export type Pigment = keyof typeof pigments;
export type Theme = 'auto' | 'light' | 'dark' | 'inherit';
export function color(pigment: Pigment) {
  if (!Object.hasOwn(pigments, pigment))
    throw new Error(`Unknown pigment: ${pigment}. Choose ${Object.keys(pigments).join(', ')}`);
  return `var(--ve-${pigment})`;
}
export function theme(root: HTMLElement | SVGElement, initial: Theme = 'auto') {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let selection = initial;
  const update = () => {
    // Embedded drawing planes follow their host, including an explicitly selected theme.
    if (selection === 'inherit') {
      root.style.colorScheme = 'inherit';
      delete root.dataset.theme;
      return;
    }
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
