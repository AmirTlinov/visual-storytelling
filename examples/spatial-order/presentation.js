import {
  Viewport3D,
  ThreeKit as T,
  shotPlan3D,
  shotProgress,
} from '@visual-storytelling/core/three';
import {
  countryDrawing,
  countryBounds,
  regionBounds,
  city,
  metre,
  metreX,
  REGION_LIFT,
  referenceScale,
  localBounds,
} from './geography.js';
import { facility, facilityBounds, orderBounds } from './facility.js';
import { releaseResources } from '@visual-storytelling/core';

const direction = [0.4, 1.2, 1.8];
const shot = (target) => ({ target, direction, referenceScale });
const cityBounds = localBounds(300 * metre, 0, 220 * metre);
const networkBounds = localBounds(
  74 * metreX,
  8 * metre,
  36 * metre,
  city.clone().add(new T.Vector3(0, 4 * metre, 0)),
);
const shotWithMargins = (value, scale) => ({
  ...value,
  padding: 22 / scale,
  insets: { bottom: 70 / scale },
  ...(value.from && {
    from: { ...value.from, padding: 22 / scale, insets: { bottom: 70 / scale } },
  }),
});

/** Chapters own only geometry. The shared document owns the order, input, trace and story clock. */
export function spatialChapter(chapter, kind, model) {
  return {
    ...chapter,
    presentation: 'stage',
    controls: ['reserve', 'disabled-provider', 'disabled-bank'],
    mount(parent) {
      const view = Viewport3D.mount(parent, { label: 'Путь заказа через карту и устройство' });
      try {
        const root = new T.Group();
        view.setObject(root, { fitView: false });
        const map = kind === 'network' ? undefined : countryDrawing(view);
        if (map) root.add(map.root);
        const device = facility(view, root, { modelId: model.id, orderId: model.inputs.orderId });
        const orderShot = { ...shot(orderBounds), target: device.packet, bounds: orderBounds };
        const networkShot = {
          ...shot(networkBounds),
          target: device.root,
          bounds: networkBounds,
          direction: [0.05, 2.5, 0.35],
        };
        const legs =
          kind === 'geography'
            ? [
                { cue: 'region', shot: shot(regionBounds), move: 3 },
                { cue: 'city', shot: shot(cityBounds), move: 3 },
                { cue: 'device', shot: shot(facilityBounds), move: 3 },
                { cue: 'order', shot: orderShot, move: 1.5 },
              ]
            : kind === 'network'
              ? [{ cue: 'connections', shot: networkShot, move: 2 }]
              : [{ cue: 'context', shot: shot(countryBounds), move: 5 }];
        const plan = shotPlan3D(
          chapter.script,
          kind === 'geography' ? shot(countryBounds) : kind === 'network' ? orderShot : networkShot,
          legs.map((leg) => ({ ...leg, move: { fraction: 0.85, maxSeconds: leg.move } })),
        );
        let current, frame;
        const labelOptions = { size: 22, tone: 'green', priority: 8, frame: { padding: [5, 3] } };
        const placeLabel = view.label(
          'Боголюбово',
          () => device.root.getWorldPosition(new T.Vector3()),
          labelOptions,
        );
        view.describe(device.root, 'location', {
          label: 'Боголюбово',
          interactive: false,
          value: () => ({ anchor: city.toArray(), cartographicLift: REGION_LIFT }),
          provenance: () => ({
            resources: ['natural-earth', 'settlement'],
            illustrativeDevice: true,
          }),
        });
        return {
          view,
          ready: view.whenRendered,
          render(value) {
            frame = value;
            current = value.subject.models[model.id];
            const scale = Math.max(0.01, parent.getBoundingClientRect().width / parent.clientWidth);
            const camera = plan.at(value.time, value.reduced);
            if (map) {
              for (const [group, foreground] of [
                [
                  map.country,
                  (kind === 'geography' && !camera.cue) ||
                    (kind === 'whole' && camera.amount === 1),
                ],
                [map.region, kind === 'geography' && camera.cue === 'region'],
              ])
                group.traverse((node) => {
                  node.userData.visualReview = { framing: foreground ? 'subject' : 'background' };
                });
            }
            device.root.traverse((node) => {
              if (node !== device.packet)
                node.userData.visualReview = {
                  framing:
                    (kind === 'network' && camera.amount === 1) ||
                    (kind === 'geography' && camera.cue === 'device')
                      ? 'subject'
                      : 'background',
                };
            });
            let rise = 1,
              open = 1;
            if (kind === 'geography') {
              const start = chapter.script.cues.region.start;
              rise = value.time < start ? 0 : camera.cue === 'region' ? camera.amount : 1;
              const opening = chapter.script.cues.order;
              open = value.time < opening.start ? 0 : camera.cue === 'order' ? camera.amount : 1;
            }
            if (map) map.region.position.y = REGION_LIFT * rise;
            device.root.position.y = REGION_LIFT * rise;
            device.render(current, {
              open,
              labelScale: scale,
              network: kind !== 'geography',
              networkOpacity:
                kind === 'network'
                  ? shotProgress((camera.amount - 0.75) / 0.25)
                  : kind === 'whole'
                    ? 1 - shotProgress(camera.amount / 0.15)
                    : 0,
            });
            labelOptions.size = 20 / scale;
            labelOptions.maxWidth = 240 / scale;
            const closing = chapter.script.cues.device;
            const placeOpacity =
              kind !== 'geography'
                ? 0
                : value.time < closing.start
                  ? 1
                  : camera.cue === 'device'
                    ? 1 - camera.amount
                    : 0;
            placeLabel.opacity(placeOpacity);
            view.shot(shotWithMargins(camera.shot, scale));
          },
          snapshot() {
            return {
              kind,
              time: frame?.time,
              order: device.snapshot(),
              camera: view.capture(),
              rise: device.root.position.y,
              gpu: { ...view.renderer.info.memory, programs: view.renderer.info.programs?.length },
            };
          },
          dispose: view.dispose,
        };
      } catch (cause) {
        releaseResources(
          [
            () => {
              throw cause;
            },
            view.dispose,
          ],
          'Spatial preparation failed.',
        );
        throw cause;
      }
    },
  };
}
