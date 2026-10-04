import type { PropArt } from './types.js';

export const workbench: PropArt = {
  svg: '<g stroke="#192d34" stroke-width="4" stroke-linejoin="round" fill="#9f7950"><path d="M-50-102h99v18h-99zM-38-84h12V0h-12zM27-84h12V0H27z"/></g>',
};
export const bulb: PropArt = {
  svg: `<defs><radialGradient id="$id-glow"><stop stop-color="#ffe4a0" stop-opacity=".42"/><stop offset="1" stop-color="#ffe4a0" stop-opacity="0"/></radialGradient></defs>
  <g stroke="#192d34" stroke-linejoin="round"><path d="M-30 0h58v-9h-58z" fill="#b49463" stroke-width="3"/><path d="M-17-10v-54q-19-15-15-35T0-123q28 2 28 24T10-64v54z" fill="#88a9a6" stroke-width="4"/><path d="M-16-58H9v45h-25z" fill="#b0a577"/><path d="M-15-50H9m-24 9H9m-24 9H9m-24 9H9" fill="none" stroke="#4f615c" stroke-width="3"/><path d="M-9-65v-28l9 8 9-8v28" fill="none" stroke="#ebe5b0" stroke-width="3"/></g>
  <g data-light opacity="0"><circle cy="-94" r="90" fill="url(#$id-glow)"/><path d="M-17-64v-3q-19-15-15-35t32-21q28 2 28 24T10-67v3z" fill="#ffe5a2"/><path d="M-57-102l-15-5m88-34 8-15m21 57 15-3" stroke="#ffd982" stroke-width="4" stroke-linecap="round"/></g>`,
  paint(node, values) {
    node.querySelector('[data-light]')!.setAttribute('opacity', String(values.light ?? 0));
  },
};
export const seedling: PropArt = {
  svg: `<g stroke="#314e49" stroke-linejoin="round" stroke-linecap="round" stroke-width="4"><path fill="#af7455" d="M-45-53h90L32-5Q0 9-32-5Z"/><path fill="#cc936a" d="M-49-66h98v18h-98z"/><ellipse cy="-65" rx="42" ry="9" fill="#655144"/><g data-growth transform="translate(0 -65)"><path d="M0 0Q-15-74 5-139" fill="none"/><path d="M-5-66Q-62-58-62-109Q-10-119-5-66Z" fill="#76a778"/><path d="M-7-95Q51-89 54-139Q10-152-7-95Z" fill="#99b97c"/><path d="M4-136Q-27-146-10-178Q22-175 4-136Z" fill="#c1cd8d"/><path d="M-5-66l-37-27m35-2 40-27" fill="none" stroke="#416e58" stroke-width="2.5"/></g></g>`,
  paint(node, values) {
    const n = 0.08 + 0.92 * Math.max(0, Math.min(1, values.growth ?? 0));
    node.querySelector('[data-growth]')!.setAttribute('transform', `translate(0 -65) scale(${n})`);
  },
};
export const spark: PropArt = {
  svg: `<defs><radialGradient id="$id-halo"><stop stop-color="#fff0bd" stop-opacity=".65"/><stop offset="1" stop-color="#ffd989" stop-opacity="0"/></radialGradient></defs><circle r="48" fill="url(#$id-halo)"/><path d="M0-23 7-7 23 0 7 7 0 23-7 7-23 0-7-7Z" fill="#ffe6a1" stroke="#957043" stroke-width="2.5"/><circle r="4" fill="#fff4d1"/>`,
};
