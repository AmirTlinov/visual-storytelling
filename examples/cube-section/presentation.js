import {
  Viewport3D,
  ThreeKit as T,
  shotPlan3D,
  InkStroke3D,
} from '@visual-storytelling/core/three';
import { releaseResources } from '@visual-storytelling/core';
const whole = new T.Box3(new T.Vector3(-1, -1, -1), new T.Vector3(1, 1, 1.2));
const cut = new T.Box3(new T.Vector3(-1, -1, 0), new T.Vector3(1, 1, 0));
const overview = { target: whole, direction: [2, 1.3, 3] },
  detail = { target: cut, direction: [0.15, 0.2, 3] };
export function cubeChapter(chapter, kind) {
  return {
    ...chapter,
    presentation: 'stage',
    controls: ['offset'],
    mount(parent) {
      const view = Viewport3D.mount(parent, { label: 'Куб и настоящее плоское сечение' });
      try {
        const root = new T.Group();
        view.setObject(root, { fitView: false });
        const box = new T.Mesh(
          new T.BoxGeometry(2, 2, 2),
          view.ink(
            new T.MeshBasicMaterial({ transparent: true, opacity: 0.08, depthWrite: false }),
            'blue',
          ),
        );
        root.add(box);
        const edges = new T.LineSegments(
          new T.EdgesGeometry(box.geometry),
          view.ink(new T.LineBasicMaterial(), 'ink'),
        );
        root.add(edges);
        const plane = new T.Mesh(
          new T.PlaneGeometry(2.5, 2.5),
          view.ink(
            new T.MeshBasicMaterial({
              transparent: true,
              opacity: 0.1,
              depthWrite: false,
              side: T.DoubleSide,
            }),
            'blue',
          ),
        );
        root.add(plane);
        plane.userData.visualReview = { framing: 'background' };
        const section = new T.Mesh(
          new T.PlaneGeometry(2, 2),
          view.ink(
            new T.MeshBasicMaterial({
              transparent: true,
              opacity: 0.35,
              depthWrite: false,
              side: T.DoubleSide,
            }),
            'orange',
          ),
        );
        root.add(section);
        const contour = InkStroke3D.create(
          view,
          [
            [-1, -1, 0],
            [1, -1, 0],
            [1, 1, 0],
            [-1, 1, 0],
            [-1, -1, 0],
          ],
          { color: 'orange', width: 2.2 },
        );
        root.add(contour.root);
        let frame, model;
        view.describe(box, 'cube:whole', {
          label: 'Куб со стороной 2',
          value: () => ({ side: 2, volume: 8 }),
          provenance: () => ({ resources: ['cube-geometry'] }),
        });
        view.describe(section, 'cube:section', {
          label: 'Сечение куба',
          value: () => model?.section,
          provenance: () => ({ resources: ['cube-geometry'], plane: 'z=constant' }),
        });
        const settings = { size: 22, tone: 'orange', frame: { padding: [5, 3] }, priority: 10 };
        view.label(
          () => (model?.section.area ? '2 × 2 = 4' : 'Сечения нет'),
          () => new T.Vector3(0, 0, model?.section.z ?? 0),
          settings,
        );
        const planAt = (z) => {
          const selectedDetail = {
            ...detail,
            target: cut.clone().translate(new T.Vector3(0, 0, z)),
          };
          const legs =
            kind === 'whole'
              ? [{ cue: 'approach', shot: overview, move: 0 }]
              : kind === 'detail'
                ? [{ cue: 'closer', shot: selectedDetail, move: 3 }]
                : [{ cue: 'context', shot: overview, move: 4 }];
          return shotPlan3D(
            chapter.script,
            kind === 'return' ? selectedDetail : overview,
            legs.map((leg) => ({ ...leg, move: { fraction: 0.85, maxSeconds: leg.move } })),
          );
        };
        let plan, plannedZ;
        return {
          view,
          ready: view.whenRendered,
          render(value) {
            frame = value;
            model = value.subject.models.cube;
            if (!plan || plannedZ !== model.section.z) {
              plannedZ = model.section.z;
              plan = planAt(plannedZ);
            }
            const scale = Math.max(0.01, parent.getBoundingClientRect().width / parent.clientWidth);
            const selected = plan.at(value.time, value.reduced),
              margin = { padding: 22 / scale, insets: { bottom: 65 / scale } };
            const contextVisible = kind === 'whole' || (kind === 'return' && selected.amount === 1);
            for (const item of [box, edges])
              item.userData.visualReview = { framing: contextVisible ? 'subject' : 'background' };
            plane.position.z = section.position.z = contour.root.position.z = model.section.z;
            section.visible = contour.root.visible = model.section.vertices.length > 0;
            settings.size = 20 / scale;
            contour.root.material.linewidth = 2.2 / scale;
            settings.maxWidth = 240 / scale;
            view.shot({ ...selected.shot, ...margin, from: { ...selected.shot.from, ...margin } });
          },
          snapshot: () => ({
            kind,
            model,
            time: frame?.time,
            camera: view.capture(),
            gpu: { ...view.renderer.info.memory, programs: view.renderer.info.programs?.length },
          }),
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
          'Cube preparation failed.',
        );
        throw cause;
      }
    },
  };
}
