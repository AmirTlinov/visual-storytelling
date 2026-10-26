import { componentsDrawing } from './components.js';
import { overviewDrawing } from './overview.js';
import { embeddingDrawing } from './embedding.js';
import { attentionDrawing } from './attention.js';
import { transformationsDrawing } from './transformations.js';
import { outputDrawing } from './output.js';
import { interpretationDrawing } from './interpretation.js';
import { detailsDrawing } from './details.js';
export function gptDrawings(context) {
  const components = componentsDrawing(context);
  return {
    ...components,
    ...overviewDrawing(context, components),
    ...embeddingDrawing(context, components),
    ...attentionDrawing(context, components),
    ...transformationsDrawing(context, components),
    ...outputDrawing(context, components),
    ...interpretationDrawing(context, components),
    ...detailsDrawing(context, components),
  };
}
