import { fusionText } from '../../ink/fusion/text.js';
import { constructionCamera } from './camera.js';
import { preparedAnnotations } from './plan.js';
import type { ConstructionPlan } from './types.js';

export type AnnotationLayout = {
  left: number;
  right: number;
  order: string[];
  inkSides: Map<string, 'top' | 'bottom'>;
  camera?: ReturnType<typeof constructionCamera>;
};

/** Reserve measured annotation space for the entire operation, so changing digits never move the drawing. */
export function annotationLayout(plan: ConstructionPlan) {
  const margins = new Map<string, AnnotationLayout>(),
    positions = new Map<string, Map<string, { sum: number; count: number }>>(),
    widths = new Map<string, number>();
  const differences = new Map<string, number>();
  const prepared =
    preparedAnnotations(plan) ??
    Array.from(
      { length: plan.stages * 24 + 1 },
      (_, i) => plan.sample(i / (plan.stages * 24)).panels,
    );
  for (const panels of prepared) {
    for (const panel of panels) {
      const entry = margins.get(panel.id) ?? {
        left: 44,
        right: 44,
        order: [],
        inkSides: new Map(),
        camera: panel.space === '3d' ? constructionCamera(panel) : undefined,
      };
      const [lo, hi] = panel.bounds,
        span = hi[0] - lo[0];
      if (panel.space === '3d') entry.camera ??= constructionCamera(panel);
      const anchors = positions.get(panel.id) ?? new Map();
      positions.set(panel.id, anchors);
      for (const label of panel.labels ?? []) {
        for (const patch of panel.patches ?? [])
          if (patch.text) {
            const center = patch.map([
              (patch.domain[0][0] + patch.domain[1][0]) / 2,
              (patch.domain[0][1] + patch.domain[1][1]) / 2,
            ]);
            const key = `${panel.id}/${label.id}/${patch.id}`;
            const difference =
              (differences.get(key) ?? 0) +
              (label.at[1] + (label.to ?? label.at)[1]) / 2 -
              center[1];
            differences.set(key, difference);
            entry.inkSides.set(
              `${label.id}/${patch.id}`,
              label.side === 'bottom'
                ? 'bottom'
                : label.side === 'top'
                  ? 'top'
                  : difference >= 0
                    ? 'top'
                    : 'bottom',
            );
          }
        const anchor = anchors.get(label.id) ?? { sum: 0, count: 0 };
        anchor.sum +=
          ((label.at[1] + (label.to ?? label.at)[1]) / 2 - lo[1]) / (hi[1] - lo[1]) +
          (label.side === 'top' ? 0.12 : label.side === 'bottom' ? -0.12 : 0);
        anchor.count++;
        anchors.set(label.id, anchor);
        if (
          (label.side === 'left' && label.at[0] <= lo[0] + span * 0.18) ||
          (label.side === 'right' && label.at[0] >= hi[0] - span * 0.18)
        ) {
          let width = widths.get(label.text);
          if (width === undefined) {
            width = fusionText(label.text, { size: 19 }).bounds.width;
            widths.set(label.text, width);
          }
          entry[label.side] = Math.max(entry[label.side], width + 24);
        }
      }
      margins.set(panel.id, entry);
    }
  }
  for (const [id, entry] of margins)
    entry.order = [...positions.get(id)!]
      .sort(([a, p], [b, q]) => q.sum / q.count - p.sum / p.count || a.localeCompare(b))
      .map(([id]) => id);
  return margins;
}
