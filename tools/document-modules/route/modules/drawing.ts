import { dependencyRouteSubject } from '@visual-storytelling/core/recipes';
import type { DependencyTrace } from '@visual-storytelling/core/recipes';
import type { StorySubjectRecipe, StorySubjectDrawing } from '@visual-storytelling/core';
import { graph } from './model.ts';
const symbol = new URL('../assets/parcel.svg', import.meta.url).href;
const base = dependencyRouteSubject(graph, {
  maker: [0.12, 0.3],
  warehouse: [0.5, 0.3],
  home: [0.88, 0.3],
});
const subject: StorySubjectRecipe = {
  ...base,
  create(shell, model): StorySubjectDrawing {
    const drawing = base.create(shell, model);
    return {
      ...drawing,
      render(...args: Parameters<StorySubjectDrawing['render']>) {
        drawing.render(...args);
        const packet = shell.stage.querySelector(
          `[data-object="${model.id}:order:${(args[2].trace as DependencyTrace).orderId}"]`,
        )!;
        let image = packet.querySelector('[data-parcel]');
        if (!image) {
          image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
          image.setAttribute('data-parcel', '');
          image.setAttribute('href', symbol);
          image.setAttribute('x', '-14');
          image.setAttribute('y', '-66');
          image.setAttribute('width', '28');
          image.setAttribute('height', '28');
          packet.append(image);
        }
      },
    };
  },
};
export default subject;
