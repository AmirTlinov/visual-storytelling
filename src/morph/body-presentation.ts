import { MathMorph2D } from './svg.js';
import { mathPlan } from './math.js';
import { SketchControls } from '../controls/index.js';
import type { MathOperation, MathMorphPlan } from './types.js';
import type { MorphCues, MorphTime } from './timing.js';
import { Viewport3D } from '../viewport/three.js';
import { MathMorph3D } from './three.js';

let serial = 0;
/** One public presentation owns projection, framing and disposal; callers supply math and time. */
export function mountBodies(
  parent: HTMLElement,
  operation: MathOperation | MathMorphPlan,
  options: {
    projection?: '2d' | '3d';
    pigment?: string;
  } = {},
) {
  const plan = mathPlan(operation);
  const root = document.createElement('div'),
    controls = document.createElement('div');
  const flatStage = document.createElement('div'),
    volumeStage = document.createElement('div');
  root.className = 've-math-view';
  controls.className = 've-math-projection';
  flatStage.className = volumeStage.className = 've-math-stage';
  root.append(controls, volumeStage, flatStage);
  parent.append(root);
  let projection = options.projection ?? '3d',
    disposed = false;
  flatStage.hidden = projection !== '2d';
  volumeStage.hidden = projection !== '3d';
  const view = Viewport3D.mount(volumeStage, {
    label: 'Формула преобразует тела и надписи. Фигуры можно поворачивать.',
  });
  try {
    const volume = MathMorph3D.mount(view, plan, options);
    const flat = MathMorph2D.mount(flatStage, plan, { ...options, id: `math-${serial++}` });
    view.setObject(volume.object, { fitView: false });
    let lastTime: MorphTime = 0,
      lastCues: MorphCues | undefined;
    const choice = SketchControls.field(
      {
        type: 'choice',
        label: 'Рисунок',
        value: projection,
        options: [
          { value: '3d', label: 'Объём' },
          { value: '2d', label: 'Плоскость' },
        ],
      },
      (value) => {
        projection = String(value) as '2d' | '3d';
        flatStage.hidden = projection !== '2d';
        volumeStage.hidden = projection !== '3d';
        render(lastTime, lastCues);
      },
    );
    controls.append(choice.element);
    function render(time: MorphTime, cues?: MorphCues) {
      if (disposed) return;
      const frame = volume.render(time, cues);
      flat.render(time, cues);
      lastTime = time;
      lastCues = cues;
      view.shot({
        target: volume.bounds,
        direction: [-2.4, 1.8, 9],
        padding: 30,
        reduced: typeof time === 'number' ? undefined : time.reduced,
      });
      return frame;
    }
    const resize = new ResizeObserver(() => render(lastTime, lastCues));
    const unbind = view.onDispose(dispose);
    function dispose() {
      if (disposed) return;
      disposed = true;
      resize.disconnect();
      choice.dispose();
      flat.dispose();
      unbind();
      view.dispose();
      root.remove();
    }
    resize.observe(parent);
    render(0);
    return {
      element: root,
      view,
      render,
      get plan() {
        return volume.plan;
      },
      get projection() {
        return projection;
      },
      setOperation(next: MathOperation | MathMorphPlan) {
        if (disposed) throw new Error('Math morph has been disposed');
        const prepared = mathPlan(next);
        const previous = { plan: volume.plan, time: lastTime, cues: lastCues };
        try {
          volume.setOperation(prepared);
          flat.setOperation(prepared);
          render(0);
        } catch (error) {
          volume.setOperation(previous.plan);
          flat.setOperation(previous.plan);
          render(previous.time, previous.cues);
          throw error;
        }
      },
      dispose,
    };
  } catch (error) {
    view.dispose();
    root.remove();
    throw error;
  }
}
