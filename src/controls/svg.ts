/* Build-time SVG parts. Native HTML owns slider behavior; range.css owns its ink. */
export function svgRange({
  id,
  x,
  y,
  width = 340,
  min = 0,
  max = 1,
  step = 0.02,
  value = 0,
  label,
}: {
  id: string;
  x: number;
  y: number;
  width?: number;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  label: string;
}) {
  const escape = (s: string | number) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
  return `<g id="${escape(id)}"><foreignObject data-native-control="" x="${x}" y="${y}" width="${width}" height="52"><div xmlns="http://www.w3.org/1999/xhtml" style="padding:calc(4 * var(--ve-control-unit,1px)) calc(8 * var(--ve-control-unit,1px))"><input id="${escape(id)}-input" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${escape(label)}"/></div></foreignObject></g>`;
}

// Keep touch targets and pen widths in screen pixels when the SVG viewBox scales.
export function fitSvgControls(root: SVGSVGElement) {
  const width = root.getBoundingClientRect().width;
  if (!width) return;
  const unit = root.viewBox.baseVal.width / width;
  root.style.setProperty('--ve-control-unit', unit + 'px');
  for (const field of root.querySelectorAll('[data-native-control]'))
    field.setAttribute('height', String(52 * unit));
}
