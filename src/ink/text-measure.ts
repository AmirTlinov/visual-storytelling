import { SVG_NS } from './dom.js';

/** Measure in logical units: a scene's screen scale must never change its glyph advances. */
export function measureText<T>(text: SVGTextElement, read: (measured: SVGTextElement) => T): T {
  const document = text.ownerDocument;
  const stage = document.createElementNS(SVG_NS, 'svg');
  const viewport = text.ownerSVGElement;
  const box = viewport?.viewBox.baseVal;
  const width = box?.width || viewport?.width.baseVal.value || 1;
  const height = box?.height || viewport?.height.baseVal.value || 1;
  if (box?.width && box.height)
    stage.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
  stage.setAttribute('aria-hidden', 'true');
  stage.style.cssText = `all:initial;position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;overflow:visible;visibility:hidden;pointer-events:none`;
  const copy = text.cloneNode(true) as SVGTextElement;
  copy.removeAttribute('id');
  copy.removeAttribute('transform');
  const style = getComputedStyle(text);
  for (const property of [
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'font-stretch',
    'font-variant',
    'font-kerning',
    'font-feature-settings',
    'font-variation-settings',
    'font-optical-sizing',
    'letter-spacing',
    'word-spacing',
    'white-space',
    'direction',
    'text-anchor',
    'text-rendering',
    'writing-mode',
    'text-orientation',
    'dominant-baseline',
    'alignment-baseline',
    'baseline-shift',
  ])
    copy.style.setProperty(property, style.getPropertyValue(property));
  copy.style.display = 'inline';
  copy.style.transform = 'none';
  stage.append(copy);
  document.body.append(stage);
  try {
    return read(copy);
  } finally {
    stage.remove();
  }
}
