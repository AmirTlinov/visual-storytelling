import { SVG_NS } from './dom.js';

/** SVG glyph metrics require a rendered tree, including when the author's tab is hidden. */
export function measureText<T>(text: SVGTextElement, read: (measured: SVGTextElement) => T): T {
  if (text.getNumberOfChars() > 0 || !text.textContent) return read(text);
  const stage = document.createElementNS(SVG_NS, 'svg');
  stage.setAttribute('aria-hidden', 'true');
  stage.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:visible;visibility:hidden;pointer-events:none';
  const copy = text.cloneNode(true) as SVGTextElement;
  copy.removeAttribute('id');
  const style = getComputedStyle(text);
  for (const property of [
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'font-stretch',
    'font-variant',
    'letter-spacing',
    'word-spacing',
    'text-anchor',
    'writing-mode',
  ])
    copy.style.setProperty(property, style.getPropertyValue(property));
  copy.style.display = 'inline';
  stage.append(copy);
  document.body.append(stage);
  try {
    return read(copy);
  } finally {
    stage.remove();
  }
}
