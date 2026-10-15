import { releaseResources } from '../../lifecycle.js';
import { surface } from '../../ink/surface.js';
import { svg } from '../../ink/dom.js';
import { paragraph } from '../../ink/paragraph.js';
import { color } from '../../ink/palette.js';
import { contentViewport } from '../../layout/content.js';
import { labelOverflow, type OverflowLabel } from '../../layout/label-overflow.js';
import { spatialPanelRenderer } from './spatial.js';
import { planarPanelRenderer } from './planar.js';
import { annotationLayout } from './annotation-layout.js';
import {
  mathMotionFrame,
  morphTiming,
  watchMotion,
  type MorphCues,
  type MorphTime,
} from '../timing.js';
import type { ConstructionPlan } from './types.js';

let serial = 0;
/** Shared geometry, pen, layout, measured labels and narrative motion for mathematical constructions. */
export function mountConstruction(
  parent: HTMLElement,
  operation: ConstructionPlan,
  { layout = 'content' }: { layout?: 'scene' | 'content' } = {},
) {
  let plan = operation,
    disposed = false,
    lastTime: MorphTime = 0,
    lastCues: MorphCues | undefined;
  let projection: '2d' | '3d' = '2d';
  let margins = annotationLayout(plan);
  const sheet = surface(parent, {
    id: `math-construction-${serial++}`,
    width: 800,
    height: 480,
    title: 'Математическое преобразование',
    description: '',
    grid: false,
  });
  sheet.element.classList.add('ve-construction');
  sheet.element.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const viewport = layout === 'scene' ? undefined : contentViewport(parent);
  const equation = paragraph(sheet.layer, { size: layout === 'scene' ? 20 : 26 }),
    explanation = paragraph(sheet.layer, { size: layout === 'scene' ? 18 : 20 });
  equation.element.style.color = color('purple');
  const detailFrame = svg('foreignObject', {
    'data-construction-details': '',
    'pointer-events': 'none',
  });
  const detailHost = document.createElement('div');
  detailHost.style.cssText = 'position:relative;width:100%;height:100%';
  detailFrame.append(detailHost);
  const details = layout === 'scene' ? labelOverflow(detailHost, { label: 'Разбор' }) : undefined;
  if (details) {
    details.element.style.pointerEvents = 'auto';
    sheet.layer.append(detailFrame);
  }
  const panels = new Map<
    string,
    {
      space: '2d' | '3d';
      up: string;
      renderer: ReturnType<typeof planarPanelRenderer> | ReturnType<typeof spatialPanelRenderer>;
    }
  >();
  function render(time: MorphTime, cues?: MorphCues) {
    if (disposed) return;
    const timing = morphTiming(time, cues, plan.stages);
    const frame = mathMotionFrame(plan, timing);
    projection = frame.panels.some((p) => p.space === '3d') ? '3d' : '2d';
    // A scene is a bounded composition. Its parent may itself be transformed by
    // SceneFrame, so use the displayed aperture once; a natural document keeps
    // local CSS coordinates and may earn additional vertical room.
    const bounded = layout === 'scene',
      screen = parent.getBoundingClientRect(),
      width = bounded ? Math.max(1, screen.width) : Math.max(280, parent.clientWidth),
      apertureHeight = Math.max(1, screen.height),
      gap = bounded ? 16 : 24,
      sideNotes = bounded && width >= 620 && apertureHeight >= 220,
      noteWidth = sideNotes ? Math.min(360, width * 0.36) : width - 16;
    if (bounded && (!screen.width || !screen.height)) {
      lastTime = time;
      lastCues = cues;
      return frame;
    }
    const extra: OverflowLabel[] = [];
    let drawingWidth = width,
      drawingHeight = apertureHeight;
    if (bounded) {
      equation.render(frame.formula, Math.max(1, noteWidth), 0, 0);
      const formula = equation.bounds;
      if (sideNotes) {
        drawingWidth = width - noteWidth - 28;
        const x = drawingWidth + 28 + noteWidth / 2,
          y = Math.max(12, apertureHeight * 0.16) - formula.y;
        equation.render(frame.formula, noteWidth, x, y);
        const descriptionY = y + formula.y + formula.height + 28;
        explanation.render(frame.explanation, noteWidth, x, 0);
        const prose = explanation.bounds;
        const fits = descriptionY + prose.height + 12 <= apertureHeight;
        explanation.element.style.display = fits ? '' : 'none';
        if (fits) explanation.render(frame.explanation, noteWidth, x, descriptionY - prose.y);
        else extra.push({ id: 'explanation', label: frame.explanation });
      } else {
        const footerHeight = formula.height + 14;
        equation.render(
          frame.formula,
          Math.max(1, noteWidth),
          width / 2,
          apertureHeight - 6 - formula.y - formula.height,
        );
        drawingHeight = Math.max(1, apertureHeight - footerHeight);
        // The explanation action has its own small column; it never covers a
        // mathematical surface, even when every source label fits this frame.
        drawingWidth = Math.max(1, width - 96);
        explanation.element.style.display = 'none';
        extra.push({ id: 'explanation', label: frame.explanation });
      }
    } else explanation.element.style.display = '';
    const columns = drawingWidth >= 680 ? Math.min(2, frame.panels.length) : 1,
      rows = Math.ceil(frame.panels.length / columns),
      panelWidth = Math.max(1, (drawingWidth - gap * (columns - 1)) / columns);
    let panelHeight = bounded
      ? Math.max(1, (drawingHeight - (rows - 1) * 16) / rows)
      : columns === 1 && frame.panels.length === 1
        ? Math.max(290, Math.min(430, width * 0.55))
        : 330;
    const renderPanels = () =>
      Math.max(
        ...frame.panels.map((panel, i) => {
          let entry = panels.get(panel.id);
          const space = panel.space ?? '2d';
          const up = margins.get(panel.id)?.camera?.up;
          const upKey = String(up ?? [0, 1, 0]);
          if (entry && (entry.space !== space || entry.up !== upKey)) {
            entry.renderer.dispose();
            panels.delete(panel.id);
            entry = undefined;
          }
          if (!entry) {
            entry = {
              space,
              up: upKey,
              renderer:
                space === '3d'
                  ? spatialPanelRenderer(sheet, panel.id, up)
                  : planarPanelRenderer(sheet, panel.id),
            };
            panels.set(panel.id, entry);
          }
          return entry.renderer.render(
            panel,
            (i % columns) * (panelWidth + gap),
            Math.floor(i / columns) * (panelHeight + 16),
            panelWidth,
            panelHeight,
            margins.get(panel.id)!,
            { bounded, heading: !bounded || (panelHeight >= 240 && frame.panels.length > 1) },
          );
        }),
      );
    const measuredHeight = renderPanels();
    if (!bounded && measuredHeight > panelHeight) {
      panelHeight = measuredHeight;
      renderPanels();
    }
    let height = apertureHeight;
    if (!bounded) {
      drawingHeight = rows * panelHeight + (rows - 1) * 16;
      const formulaY = drawingHeight + 22;
      const equationHeight = equation.render(frame.formula, width - 28, width / 2, formulaY);
      const descriptionY = formulaY + Math.max(equationHeight, width < 480 ? 64 : 36) + 22;
      const descriptionHeight = explanation.render(
        frame.explanation,
        width - 32,
        width / 2,
        descriptionY,
      );
      height = Math.ceil(descriptionY + Math.max(descriptionHeight, width < 480 ? 140 : 70) + 14);
    }
    sheet.resize(width, height, false);
    viewport?.resize(height);
    for (const [id, entry] of panels)
      if (!frame.panels.some((p) => p.id === id)) {
        entry.renderer.dispose();
        panels.delete(id);
      }
    if (details) {
      for (const entry of panels.values())
        if ('overflow' in entry.renderer) extra.push(...entry.renderer.overflow);
      detailFrame.setAttribute('width', String(width));
      detailFrame.setAttribute('height', String(height));
      details.preferred({ x: 0, y: 0, width, height });
      details.update(extra, {
        x: width - 92,
        y: Math.max(0, drawingHeight / 2 - 22),
        width: 88,
        height: 44,
      });
      detailFrame.style.display = extra.length ? '' : 'none';
      // Renderers are mounted lazily; the action stays above their SVG groups.
      sheet.layer.append(detailFrame);
    }
    sheet.element.querySelector('desc')!.textContent = [
      ...frame.panels.map((panel) => panel.title),
      frame.formula,
      frame.explanation,
    ]
      .filter(Boolean)
      .join('. ');
    sheet.element.dataset.stage = String(frame.stage);
    lastTime = time;
    lastCues = cues;
    return frame;
  }
  const observer = new ResizeObserver(() => render(lastTime, lastCues));
  observer.observe(parent);
  const frame = parent.closest('[data-scene-frame]');
  const resizeFrame = () => render(lastTime, lastCues);
  frame?.addEventListener('scene-frame-resize', resizeFrame);
  const unwatch = watchMotion(() => render(lastTime, lastCues));
  function dispose() {
    if (disposed) return;
    disposed = true;
    releaseResources(
      [
        () => observer.disconnect(),
        () => frame?.removeEventListener('scene-frame-resize', resizeFrame),
        unwatch,
        ...[...panels.values()].map((p) => () => p.renderer.dispose()),
        () => equation.dispose(),
        () => explanation.dispose(),
        () => details?.dispose(),
        () => viewport?.dispose(),
        () => sheet.dispose(),
      ],
      'Mathematical construction disposal failed.',
    );
  }
  try {
    render(0);
  } catch (error) {
    releaseResources(
      [
        () => {
          throw error;
        },
        dispose,
      ],
      'Construction initialization failed.',
    );
    throw error;
  }
  return {
    element: sheet.element,
    view: {
      reset() {
        panels.forEach((p) => {
          'reset' in p.renderer && p.renderer.reset();
        });
        render(lastTime, lastCues);
      },
      dispose,
    },
    render,
    dispose,
    get plan() {
      return plan;
    },
    get projection() {
      return projection;
    },
    setOperation(operation: ConstructionPlan) {
      const next = operation,
        nextMargins = annotationLayout(next);
      const previous = { plan, margins, time: lastTime, cues: lastCues };
      plan = next;
      margins = nextMargins;
      try {
        render(0);
      } catch (error) {
        plan = previous.plan;
        margins = previous.margins;
        render(previous.time, previous.cues);
        throw error;
      }
    },
  };
}
