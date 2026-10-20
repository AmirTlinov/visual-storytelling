import type { DrawingViewport } from '../story/subject.js';
export function comparisonViewports(parent: DrawingViewport) {
  const container = document.createElement('div');
  container.dataset.comparison = '';
  Object.assign(container.style, { position: 'absolute', inset: '0', visibility: 'hidden' });
  parent.stage.append(container);
  const cases = (['before', 'after'] as const).map((side) => {
    const frame = document.createElement('div'),
      heading = document.createElement('div'),
      stage = document.createElement('div');
    frame.dataset.comparisonCase = side;
    heading.textContent = side === 'before' ? 'Было' : 'Стало';
    Object.assign(frame.style, { position: 'absolute' });
    Object.assign(heading.style, { textAlign: 'center' });
    Object.assign(stage.style, { position: 'relative' });
    frame.append(heading, stage);
    container.append(frame);
    const viewport: DrawingViewport = {
      stage,
      get layout() {
        const outer = parent.layout,
          wide = outer.displayWidth >= 766,
          gap = 16 / outer.scale;
        const width = wide ? (outer.width - gap) / 2 : outer.width;
        const height = outer.height - 34 / outer.scale;
        const bounds = stage.getBoundingClientRect();
        const visible =
          frame.getAttribute('aria-hidden') !== 'true' && container.style.visibility === '';
        return {
          ...outer,
          width,
          height,
          displayWidth: visible ? bounds.width : 0,
          displayHeight: visible ? bounds.height : 0,
          compact: width * outer.scale < 600,
        };
      },
    };
    return { side, frame, heading, viewport };
  });
  function layout(active: 'before' | 'after', revealAfter = true) {
    if (!revealAfter) active = 'before';
    const outer = parent.layout,
      wide = outer.displayWidth >= 766,
      gap = 16 / outer.scale;
    for (const [index, item] of cases.entries()) {
      const { width, height } = item.viewport.layout;
      Object.assign(item.frame.style, {
        left: `${wide ? index * (width + gap) : 0}px`,
        top: '0',
        width: `${width}px`,
        height: `${outer.height}px`,
        visibility:
          (!wide && item.side !== active) || (wide && item.side === 'after' && !revealAfter)
            ? 'hidden'
            : 'inherit',
      });
      item.frame.setAttribute(
        'aria-hidden',
        String((!wide && item.side !== active) || (wide && item.side === 'after' && !revealAfter)),
      );
      item.frame.toggleAttribute('data-comparison-active', item.side === active);
      item.heading.style.fontWeight = item.side === active ? '600' : '';
      item.heading.style.fontSize = `${18 / outer.scale}px`;
      item.heading.style.height = `${34 / outer.scale}px`;
      item.viewport.stage.style.width = `${width}px`;
      item.viewport.stage.style.height = `${height}px`;
    }
  }
  return {
    container,
    cases,
    layout,
    show() {
      container.style.visibility = '';
    },
    dispose() {
      container.remove();
    },
  };
}
