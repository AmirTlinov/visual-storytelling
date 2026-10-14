import { CharacterStage, chibi } from '@visual-storytelling/core/characters';
import { surface, object, lettering } from '@visual-storytelling/core/ink';
import { plot } from '@visual-storytelling/core/recipes';
import { snapshotSVG } from '@visual-storytelling/core/export';
import { releaseResources, describeObject } from '@visual-storytelling/core';
import { experiment } from './model.js';

let instance = 0;
const smooth = (v) => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};
/** Both presentations project the same physical block and measured trace. */
export function blockChapter(chapter, kind, shared) {
  return {
    ...chapter,
    presentation: 'stage',
    controls: ['angle', 'friction', 'push'],
    async mount(parent, signal) {
      let render;
      let latest,
        model = shared.experiment.state({ angle: 8, friction: 0.55, push: 6 }, 0),
        analysis = 0;
      let stage, drawing, chart, curve, traceKey;
      const coordinates = (x, y) => {
        const a = (model.angle * Math.PI) / 180,
          c = Math.cos(a),
          s = Math.sin(a);
        // Following the subject is a view translation; distance stays in real metres.
        const origin = 720 - analysis * 340;
        const travel = Math.max(0, model.distance - 1.5);
        return [origin + 150 * ((x - travel) * c - y * s), 430 + 150 * ((x - travel) * s + y * c)];
      };
      const actorPose = () => {
        const foot = coordinates(model.position[0] - 0.75, 0),
          tip = coordinates(model.position[0] - 0.4, -0.78);
        return {
          at: { x: foot[0], y: foot[1] },
          scale: 0.5,
          clip: chibi.rig.views.front,
          rotation: (model.angle * Math.PI) / 180,
          mood: model.forces.push ? 'determined' : 'think',
          reach: [
            { hand: 'right', at: { x: tip[0], y: tip[1] }, weight: model.forces.push > 0 ? 1 : 0 },
          ],
        };
      };
      const dispose = () => {
        releaseResources(
          [() => chart?.dispose(), () => drawing?.dispose(), () => stage?.dispose()],
          'Physical presentation disposal failed.',
        );
      };
      const live = {
        render(state) {
          if (latest)
            render({ ...latest, subject: { ...latest.subject, models: { block: state } } });
        },
        snapshot: () => ({ model, cast: stage?.snapshot(), analysis }),
      };
      try {
        stage = await CharacterStage.mount(parent, {
          pack: chibi,
          set: { width: 1280, height: 720, svg: '', spots: {} },
          background: false,
          cast: { experimenter: { skin: 'tesla-workshop', at: { x: 600, y: 430 }, scale: 0.5 } },
          pose: actorPose,
          beats:
            chapter.beats?.map((beat) => ({ id: beat.id, seconds: beat.seconds })) ??
            Object.keys(chapter.script.cues).map((id) => ({ id })),
          script: chapter.script,
        });
        signal.throwIfAborted();
        stage.canvas.dataset.object = 'experimenter';
        describeObject(stage.canvas, {
          label: 'Персонаж прикладывает заданную силу',
          value: () => ({ push: model.forces.push, units: 'N', kinematic: true }),
          provenance: () => ({ resources: ['block-model'] }),
        });
        drawing = surface(parent, {
          id: `block-drawing-${++instance}`,
          width: 1280,
          height: 720,
          title: 'Тот же брусок и измеренный путь',
          description:
            'Rapier рассчитывает движение и контакт. Ползунки меняют угол, трение и силу.',
          grid: false,
        });
        Object.assign(drawing.element.style, {
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        });
        const plane = object(drawing.layer, 'incline');
        plane.element.dataset.reviewFraming = 'background';
        drawing.pen.line(plane.content, 'plane', [-280, 0], [200, 0], { width: 2.2 });
        plane.describe({
          label: 'Наклонная плоскость',
          value: () => ({ angle: model.angle, friction: model.friction }),
          provenance: () => ({ resources: ['block-model'] }),
        });
        const block = object(drawing.layer, 'block', 'orange');
        drawing.pen.rect(block.content, 'body', -60, -75, 120, 150, { fill: 'marker', width: 2.4 });
        block.describe({
          label: 'Брусок массой 2 кг',
          value: () => model,
          provenance: () => ({ resources: ['block-model'], engine: model.engine }),
        });
        let label, distance, forceText, labelSize;
        const forces = object(drawing.layer, 'forces');
        const normal = drawing.pen.arrow(forces.content, 'normal', [0, 0], [0, -80], { width: 2 });
        const friction = drawing.pen.arrow(forces.content, 'friction', [0, 0], [-80, 0], {
          width: 2,
        });
        const push = drawing.pen.arrow(forces.content, 'push', [0, 0], [80, 0], { width: 2 });

        render = (frame) => {
          latest = frame;
          model = shared.mode?.ownsRequested
            ? shared.experiment.liveState()
            : frame.subject.models.block;
          analysis = kind === 'measure' ? smooth(frame.time / 2) : 0;
          const scale = Math.max(0.01, parent.getBoundingClientRect().width / 1280);
          const size = Math.min(64, 18 / scale);
          drawing.fitViewport(parent.clientWidth || 1280, parent.clientHeight || 720);
          if (size !== labelSize) {
            label?.dispose();
            distance?.dispose();
            forceText?.dispose();
            label = lettering(block.content, '2 кг', { x: 0, y: 0, size });
            distance = lettering(drawing.layer, '', { x: 90, y: 110, size, anchor: 'start' });
            forceText = lettering(drawing.layer, '', { x: 90, y: 180, size, anchor: 'start' });
            labelSize = size;
          }
          const angle = model.angle,
            centre = coordinates(...model.position),
            base = coordinates(model.position[0], 0);
          plane.at(...base, angle);
          block.at(...centre, angle);
          forces.at(...centre, angle);
          const forceScale = Math.min(
            6,
            120 / Math.max(1, model.forces.normal, model.forces.friction, model.forces.push),
          );
          const n = model.forces.normal * forceScale,
            f = model.forces.friction * forceScale,
            p = model.forces.push * forceScale;
          normal.between([90, 0], [90, -n]);
          friction.between([0, 90], [-f, 90]);
          push.between([0, 90], [p, 90]);
          push.element.style.display = p > 0 ? '' : 'none';
          friction.element.style.display = f > 0 ? '' : 'none';
          forces.show(analysis > 0.5);
          forceText.text(
            analysis > 0.5
              ? `трение: ${model.forces.friction.toFixed(1)} Н`
              : `μ = ${model.friction.toFixed(2)}`,
          );
          distance.text(`${model.distance.toFixed(2)} м за ${model.time.toFixed(1)} с`);
          stage.render(frame.time, frame.reduced, frame);
          stage.canvas.style.opacity = String(1 - analysis);
          if (analysis > 0) {
            const key = `${model.angle}/${model.friction}/${model.push}/${size}`;
            if (key !== traceKey) {
              chart?.dispose();
              const max = Math.max(0.1, ...model.trace.map((sample) => sample.distance));
              chart = plot(drawing, 'distance-plot', {
                x: 760,
                y: 190,
                width: 350,
                height: 200,
                xDomain: [0, 3],
                yDomain: [0, max * 1.08],
                xTicks: [
                  { value: 0, label: '0' },
                  { value: 3, label: '3 с' },
                ],
                yTicks: [{ value: max, label: `${max.toFixed(1)} м` }],
                tickSize: size,
                labelSize: size,
              });
              curve = chart.trace(
                'measured',
                model.trace.map((s) => [s.time, s.distance]),
                'orange',
              );
              curve.showAhead(false);
              chart.describe({
                label: 'Измеренный путь бруска',
                value: () => ({ units: { x: 's', y: 'm' }, samples: model.trace }),
                provenance: () => ({ resources: ['block-model'], source: 'Rapier fixed steps' }),
              });
              traceKey = key;
            }
            chart.element.setAttribute('opacity', String(analysis));
            curve.at(model.time, model.distance);
            chart.layout();
          }
          if (chart) chart.element.setAttribute('opacity', String(analysis));
        };
        return {
          render,
          live,
          snapshot: live.snapshot,
          async capture() {
            const cast = await stage.capture(),
              ink = await snapshotSVG(drawing.element, cast.width / 1280);
            const canvas = document.createElement('canvas');
            canvas.width = cast.width;
            canvas.height = cast.height;
            const ctx = canvas.getContext('2d');
            ctx.globalAlpha = 1 - analysis;
            ctx.drawImage(cast, 0, 0);
            ctx.globalAlpha = 1;
            ctx.drawImage(ink, 0, 0, canvas.width, canvas.height);
            return canvas;
          },
          dispose,
        };
      } catch (cause) {
        releaseResources(
          [
            () => {
              throw cause;
            },
            dispose,
          ],
          'Physical presentation preparation failed.',
        );
        throw cause;
      }
    },
  };
}
