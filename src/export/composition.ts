import { svg } from '../ink/dom.js';
import { exportSVG } from './index.js';
import { appendPaper, paint } from './paper.js';

const unsupported = () =>
  new Error(
    'The complete frame contains content unsupported by SVG. Use PNG or HTML, or provide SceneHandle.exportSVG() for the complete composition.',
  );
const number = (value: string) => parseFloat(value) || 0;
const transparent = (value: string) => value === 'transparent' || /[,/]\s*0\s*\)$/.test(value);
const visible = (element: Element) =>
  element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
  !element.closest('.sr-only,.vs-sr,.ve-surface-label') &&
  !/inset\((?:50|100)%\)/.test(getComputedStyle(element).clipPath);

/** A native slider's anonymous boxes use the same authored CSS as the live control. */
function sliderStyle(input: HTMLInputElement, pseudo: string) {
  const probe = document.createElement('span');
  const inherited = getComputedStyle(input);
  const declarations: string[] = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) visit(rule.styleSheet.cssRules);
      } else if (rule instanceof CSSMediaRule) {
        if (matchMedia(rule.conditionText).matches) visit(rule.cssRules);
      } else if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) visit(rule.cssRules);
      } else if (rule instanceof CSSStyleRule) {
        if (
          rule.selectorText.split(',').some((selector) => {
            const at = selector.indexOf(pseudo);
            return at >= 0 && input.matches(selector.slice(0, at));
          })
        )
          declarations.push(rule.style.cssText);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      // Unreadable external rules cannot define a supported local control.
    }
  }
  if (!declarations.length) throw unsupported();
  probe.style.cssText = declarations.join(';');
  for (const key of inherited)
    if (key.startsWith('--')) probe.style.setProperty(key, inherited.getPropertyValue(key));
  Object.assign(probe.style, {
    position: 'fixed',
    left: '-10000px',
    visibility: 'hidden',
    display: 'block',
  });
  input.parentElement!.append(probe);
  const style = getComputedStyle(probe);
  const result = {
    width: number(style.width),
    height: number(style.height),
    marginTop: number(style.marginTop),
    border: number(style.borderTopWidth),
    ink: style.borderTopColor,
    fill: style.backgroundColor,
    radius: style.borderTopLeftRadius,
  };
  probe.remove();
  return result;
}

/** Freeze the supported SVG drawing and the shared shell's vector ink as one composition. */
export async function exportCompositionSVG(content: HTMLElement): Promise<string> {
  const rect = content.getBoundingClientRect();
  const width = content.clientWidth,
    height = content.clientHeight;
  if (!width || !height || !rect.width || !rect.height) throw unsupported();
  const scale = rect.width / width;
  let coordinates = { x: rect.x, y: rect.y, scaleX: scale, scaleY: scale };
  const result = svg('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    overflow: 'hidden',
  });
  const pending: Promise<void>[] = [];
  const popovers: SVGElement[] = [];
  let clips = 0;
  const definitions = svg('defs');
  result.append(definitions);
  appendPaper(result, definitions, content, { x: 0, y: 0, width, height }, rect, true);
  let surfaces = 0;
  const box = (element: Element) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: (bounds.x - coordinates.x) / coordinates.scaleX,
      y: (bounds.y - coordinates.y) / coordinates.scaleY,
      width: bounds.width / coordinates.scaleX,
      height: bounds.height / coordinates.scaleY,
    };
  };
  const fill = (parent: SVGElement, bounds: ReturnType<typeof box>, color: string) => {
    if (!transparent(color)) parent.append(svg('rect', { ...bounds, fill: paint(color) }));
  };
  const context = document.createElement('canvas').getContext('2d')!;
  const text = (parent: SVGElement, value: string, bounds: DOMRect, style: CSSStyleDeclaration) => {
    if (!value.trim()) return;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metrics = context.measureText(value);
    const ascent = metrics.fontBoundingBoxAscent,
      descent = metrics.fontBoundingBoxDescent;
    const label = svg(
      'text',
      {
        x: (bounds.x - coordinates.x) / coordinates.scaleX,
        y:
          (bounds.y - coordinates.y) / coordinates.scaleY +
          (bounds.height / coordinates.scaleY - ascent - descent) / 2 +
          ascent,
        fill: paint(style.color),
        'font-family': style.fontFamily,
        'font-size': style.fontSize,
        'font-weight': style.fontWeight,
        'font-style': style.fontStyle,
        'letter-spacing': style.letterSpacing,
        'word-spacing': style.wordSpacing,
        'xml:space': 'preserve',
      },
      value,
    );
    parent.append(label);
  };
  const textNode = (
    parent: SVGElement,
    node: Text,
    style: CSSStyleDeclaration,
    ellipsis?: number,
  ) => {
    const range = document.createRange();
    let line: { value: string; bounds: DOMRect } | undefined;
    const flush = () => {
      if (!line) return;
      let value = line.value;
      if (ellipsis !== undefined) {
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const characters = Array.from(value);
        while (characters.length && context.measureText(characters.join('') + '…').width > ellipsis)
          characters.pop();
        value = characters.join('') + '…';
      }
      text(parent, value, line.bounds, style);
    };
    for (let index = 0; index < node.length; index++) {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const bounds = range.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      if (line && Math.abs(line.bounds.y - bounds.y) < 0.1) {
        line.value += node.data[index];
      } else {
        flush();
        line = { value: node.data[index]!, bounds };
      }
    }
    flush();
  };
  const pseudo = (parent: SVGElement, element: HTMLElement, name: string) => {
    const style = getComputedStyle(element, name);
    if (style.content === 'none' || style.display === 'none' || Number(style.opacity) === 0) return;
    if (!['""', "''"].includes(style.content)) throw unsupported();
    if (style.filter !== 'none' || style.boxShadow !== 'none') throw unsupported();
    const bounds = box(element);
    const w = number(style.width),
      h = number(style.height);
    if (!w || !h) return;
    const x =
      bounds.x +
      (style.left === 'auto' ? bounds.width - number(style.right) - w : number(style.left));
    const y =
      bounds.y +
      (style.top === 'auto' ? bounds.height - number(style.bottom) - h : number(style.top));
    const group = svg('g', { opacity: style.opacity });
    parent.append(group);
    const transform = style.transform === 'none' ? new DOMMatrix() : new DOMMatrix(style.transform);
    const [ox = 0, oy = 0] = style.transformOrigin.split(' ').map(number);
    const matrix = new DOMMatrix()
      .translate(x + ox, y + oy)
      .multiply(transform)
      .translate(-ox, -oy);
    group.setAttribute('transform', matrix.toString());
    const mask = style.maskImage.match(/^url\((["']?)(data:image\/svg\+xml,.*)\1\)$/);
    if (mask) {
      const source = new DOMParser().parseFromString(
        decodeURIComponent(mask[2]!.split(',').slice(1).join(',')),
        'image/svg+xml',
      ).documentElement;
      if (source.localName !== 'svg') throw unsupported();
      source.setAttribute('width', String(w));
      source.setAttribute('height', String(h));
      source.setAttribute('preserveAspectRatio', 'none');
      for (const mark of source.querySelectorAll('[fill],[stroke]'))
        for (const key of ['fill', 'stroke'])
          if (mark.hasAttribute(key) && mark.getAttribute(key) !== 'none')
            mark.setAttribute(key, paint(style.backgroundColor));
      group.append(source);
    } else {
      if (style.maskImage !== 'none') throw unsupported();
      fill(group, { x: 0, y: 0, width: w, height: h }, style.backgroundColor);
      for (const [side, points] of Object.entries({
        Top: [0, 0, w, 0],
        Right: [w, 0, w, h],
        Bottom: [0, h, w, h],
        Left: [0, 0, 0, h],
      })) {
        const border = number(style.getPropertyValue(`border-${side.toLowerCase()}-width`));
        if (border)
          group.append(
            svg('line', {
              x1: points[0]!,
              y1: points[1]!,
              x2: points[2]!,
              y2: points[3]!,
              stroke: style.getPropertyValue(`border-${side.toLowerCase()}-color`),
              'stroke-width': border,
            }),
          );
      }
    }
  };
  const walk = (element: Element, parent: SVGElement, sharedOverflow = false) => {
    if (!visible(element)) return;
    if (
      element.matches('.ve-chapter-menu[popover]:popover-open') &&
      !parent.hasAttribute('data-export-chapter-menu')
    ) {
      // Native chapter choices leave the scaled sheet for the top layer. Their
      // physical text and geometry must enter the exported frame at the same scale.
      const bounds = element.getBoundingClientRect(),
        previous = coordinates,
        overlay = svg('g', {
          'data-export-chapter-menu': '',
          transform: `translate(${(bounds.x - rect.x) / scale} ${(bounds.y - rect.y) / scale}) scale(${1 / scale})`,
        });
      coordinates = { x: bounds.x, y: bounds.y, scaleX: 1, scaleY: 1 };
      try {
        walk(element, overlay);
        popovers.push(overlay);
      } finally {
        coordinates = previous;
      }
      return;
    }
    if (element instanceof SVGSVGElement) {
      const htmlLayers = [...element.querySelectorAll('foreignObject')].map((node) =>
        visible(node) ? overflowInk(node) : undefined,
      );
      const style = getComputedStyle(element);
      if (
        [style.transform, style.translate, style.rotate, style.scale].some(
          (value) => value !== 'none',
        )
      )
        throw unsupported();
      for (const mark of [element, ...element.querySelectorAll('*')]) {
        if (!(mark instanceof SVGElement) || !visible(mark)) continue;
        const ink = getComputedStyle(mark);
        // Native SVG filters and their definitions travel with the cloned drawing.
        // A stylesheet override would be lost when exportSVG removes its classes.
        const nativeFilter = (mark.getAttribute('filter') ?? 'none').replaceAll(/["']/g, '');
        if (
          ink.filter.replaceAll(/["']/g, '') !== nativeFilter ||
          (ink.clipPath !== 'none' && !mark.hasAttribute('clip-path')) ||
          (ink.maskImage !== 'none' && !mark.hasAttribute('mask'))
        )
          throw unsupported();
      }
      const bounds = box(element),
        marker = svg('g');
      parent.append(marker);
      // exportSVG clones geometry/styles synchronously before its first await.
      const frozen = exportSVG(element, { paper: false });
      pending.push(
        frozen.then((source) => {
          const drawing = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
          // Only the shared overflow owner has a complete vector representation.
          // Dormant foreignObjects also leave the file: they can taint SVG decoding.
          drawing.querySelectorAll('foreignObject').forEach((node, index) => {
            const ink = htmlLayers[index];
            if (ink) node.replaceWith(ink);
            else node.remove();
          });
          for (const [key, value] of Object.entries(bounds))
            drawing.setAttribute(key, String(value));
          (drawing as unknown as SVGSVGElement).style.width = `${bounds.width}px`;
          (drawing as unknown as SVGSVGElement).style.height = `${bounds.height}px`;
          marker.append(drawing);
        }),
      );
      surfaces++;
      return;
    }
    if (
      !(element instanceof HTMLElement) ||
      !(
        /^(DIV|SECTION|MAIN|NAV|H[1-6]|P|SPAN|LABEL|LEGEND|FIELDSET|BUTTON|OUTPUT|INPUT)$/.test(
          element.tagName,
        ) ||
        (sharedOverflow && /^(UL|LI)$/.test(element.tagName))
      )
    )
      throw unsupported();
    if (
      !sharedOverflow &&
      element.closest('.ve-stage') &&
      (element.childNodes.length === 0 ||
        [...element.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        ))
    )
      throw unsupported();
    const style = getComputedStyle(element),
      bounds = box(element);
    const overflowPanel = sharedOverflow && element.matches('.ve-label-overflow-list');
    if (element !== content && style.transform !== 'none') {
      // Native popovers leave the SVG for the top layer. labelOverflow restores
      // exactly this scale; measured coordinates already include it.
      const transform = new DOMMatrix(style.transform);
      if (
        !overflowPanel ||
        !transform.is2D ||
        Math.abs(transform.a - coordinates.scaleX) > 1e-5 ||
        Math.abs(transform.d - coordinates.scaleY) > 1e-5 ||
        transform.b ||
        transform.c ||
        transform.e ||
        transform.f
      )
        throw unsupported();
    }
    if (style.translate !== 'none' || style.rotate !== 'none' || style.scale !== 'none')
      throw unsupported();
    if (style.filter !== 'none' || style.boxShadow !== 'none' || style.textShadow !== 'none')
      throw unsupported();
    const sides = ['top', 'right', 'bottom', 'left'];
    const border = number(style.borderTopWidth);
    const separator =
      element.parentElement === content &&
      element.matches('.ve-scene-header') &&
      number(style.borderBottomWidth) > 0 &&
      style.borderBottomStyle === 'solid' &&
      ['top', 'right', 'left'].every(
        (side) => number(style.getPropertyValue(`border-${side}-width`)) === 0,
      );
    if (sides.some((side) => number(style.getPropertyValue(`border-${side}-width`)))) {
      if (
        !separator &&
        (!overflowPanel ||
          sides.some(
            (side) =>
              number(style.getPropertyValue(`border-${side}-width`)) !== border ||
              style.getPropertyValue(`border-${side}-style`) !== 'solid' ||
              style.getPropertyValue(`border-${side}-color`) !== style.borderTopColor,
          ))
      )
        throw unsupported();
    }
    // Native ellipsis owns hidden text which Range still measures. Never publish that tail.
    const ellipsis = style.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth;
    if (ellipsis && !element.matches('.ve-select-trigger')) throw unsupported();
    const paperRegion = element.matches('.ve-scene-paper');
    if (style.backgroundImage !== 'none' && element !== content && !paperRegion)
      throw unsupported();
    if (style.clipPath !== 'none' || style.maskImage !== 'none') throw unsupported();
    const group = svg('g', { opacity: style.opacity });
    parent.append(group);
    if (
      ['hidden', 'clip', 'auto', 'scroll'].some(
        (value) => style.overflowX === value || style.overflowY === value,
      )
    ) {
      const id = `export-composition-clip-${++clips}`;
      const clip = svg('clipPath', { id });
      clip.append(svg('rect', bounds));
      definitions.append(clip);
      group.setAttribute('clip-path', `url(#${id})`);
    }
    if (paperRegion)
      appendPaper(group, definitions, element, bounds, element.getBoundingClientRect());
    else fill(group, bounds, style.backgroundColor);
    if (separator) {
      const weight = number(style.borderBottomWidth),
        y = bounds.y + bounds.height - weight / 2;
      group.append(
        svg('line', {
          x1: bounds.x,
          y1: y,
          x2: bounds.x + bounds.width,
          y2: y,
          stroke: paint(style.borderBottomColor),
          'stroke-width': weight,
        }),
      );
    }
    if (border)
      group.append(
        svg('rect', {
          x: bounds.x + border / 2,
          y: bounds.y + border / 2,
          width: Math.max(0, bounds.width - border),
          height: Math.max(0, bounds.height - border),
          fill: 'none',
          stroke: paint(style.borderTopColor),
          'stroke-width': border,
        }),
      );
    if (sharedOverflow && element.tagName === 'LI') {
      if (style.listStyleType !== 'disc' || style.listStylePosition !== 'outside')
        throw unsupported();
      const size = number(style.fontSize);
      group.append(
        svg('circle', {
          cx: bounds.x - size * 0.55,
          cy: bounds.y + number(style.lineHeight) / 2,
          r: size * 0.12,
          fill: paint(style.color),
        }),
      );
    }
    pseudo(group, element, '::before');
    if (element instanceof HTMLInputElement) {
      if (element.type !== 'range' || !element.closest('.ve-control-range')) throw unsupported();
      const track = sliderStyle(element, '::-webkit-slider-runnable-track');
      const thumb = sliderStyle(element, '::-webkit-slider-thumb');
      const fraction = Math.max(
        0,
        Math.min(
          1,
          (element.valueAsNumber - Number(element.min || 0)) /
            (Number(element.max || 100) - Number(element.min || 0)),
        ),
      );
      const top = bounds.y + (bounds.height - track.height) / 2;
      group.append(
        svg('line', {
          x1: bounds.x,
          y1: top + track.border / 2,
          x2: bounds.x + bounds.width,
          y2: top + track.border / 2,
          stroke: track.ink,
          'stroke-width': track.border,
        }),
      );
      group.append(
        svg('ellipse', {
          cx: bounds.x + thumb.width / 2 + fraction * (bounds.width - thumb.width),
          cy: top + thumb.marginTop + thumb.height / 2,
          rx: (thumb.width - thumb.border) / 2,
          ry: (thumb.height - thumb.border) / 2,
          fill: thumb.fill,
          stroke: thumb.ink,
          'stroke-width': thumb.border,
          'data-control-value': element.value,
        }),
      );
    } else {
      for (const node of element.childNodes) {
        if (node instanceof Text) {
          if (ellipsis) group.append(svg('title', {}, node.data));
          textNode(
            group,
            node,
            style,
            ellipsis
              ? element.clientWidth - number(style.paddingLeft) - number(style.paddingRight)
              : undefined,
          );
        } else if (node instanceof Element) walk(node, group, sharedOverflow);
      }
    }
    pseudo(group, element, '::after');
  };
  function overflowInk(layer: SVGForeignObjectElement) {
    const host = layer.firstElementChild,
      button = host?.querySelector(':scope > button.ve-label-overflow'),
      panel = host?.querySelector(':scope > .ve-label-overflow-list[popover]'),
      list = panel?.firstElementChild;
    if (
      !layer.matches('[data-svg-overflow],[data-construction-details]') ||
      layer.children.length !== 1 ||
      !(host instanceof HTMLElement) ||
      host.children.length !== 2 ||
      !button ||
      !panel ||
      button.getAttribute('popovertarget') !== panel.id ||
      panel.children.length !== 1 ||
      list?.tagName !== 'UL' ||
      [...list.children].some((item) => item.tagName !== 'LI' || item.children.length) ||
      button.children.length ||
      [...host.childNodes, ...panel.childNodes].some(
        (node) => node instanceof Text && node.textContent?.trim(),
      )
    )
      throw unsupported();
    const matrix = (layer.parentElement as unknown as SVGGraphicsElement).getScreenCTM();
    if (!matrix || matrix.a <= 0 || Math.abs(matrix.a - matrix.d) > 1e-5 || matrix.b || matrix.c)
      throw unsupported();
    const previous = coordinates;
    coordinates = { x: matrix.e, y: matrix.f, scaleX: matrix.a, scaleY: matrix.a };
    try {
      const ink = svg('g', {
        'data-export-overflow': '',
        opacity: getComputedStyle(layer).opacity,
      });
      walk(button, ink, true);
      if (visible(panel)) {
        const style = getComputedStyle(panel),
          transform = style.transform === 'none' ? new DOMMatrix() : new DOMMatrix(style.transform),
          bounds = panel.getBoundingClientRect();
        if (
          !transform.is2D ||
          transform.a <= 0 ||
          transform.d <= 0 ||
          transform.b ||
          transform.c ||
          transform.e ||
          transform.f
        )
          throw unsupported();
        // The top layer has its own physical scale (client size rounds to whole
        // pixels), so freeze its two axes rather than rounding it to the SVG's.
        coordinates = { x: bounds.x, y: bounds.y, scaleX: transform.a, scaleY: transform.d };
        const overlay = svg('g', {
          'data-export-overflow-popover': '',
          transform: `translate(${(bounds.x - rect.x) / scale} ${(bounds.y - rect.y) / scale}) scale(${transform.a / scale} ${transform.d / scale})`,
        });
        walk(panel, overlay, true);
        popovers.push(overlay);
      }
      return ink;
    } finally {
      coordinates = previous;
    }
  }
  try {
    walk(content, result);
    if (!surfaces) throw unsupported();
    result.append(...popovers);
  } catch (error) {
    void Promise.allSettled(pending);
    throw error;
  }
  await Promise.all(pending);
  return new XMLSerializer().serializeToString(result);
}
