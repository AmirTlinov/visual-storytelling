import {
  OrbitControls,
  MOUSE,
  Spherical,
  Vector3,
  Quaternion,
  type PerspectiveCamera,
  type OrthographicCamera,
} from './engine.js';

export const orbitHelp =
  'Левая кнопка и стрелки — вращение; средняя кнопка, Shift и левая кнопка или Shift и стрелки — перенос; колесо и плюс или минус — масштаб; Home — исходный вид.';

/** One gesture and keyboard policy for Three surfaces and projected SVG models. */
export function orbitControls(
  camera: PerspectiveCamera | OrthographicCamera,
  element: HTMLElement | SVGSVGElement,
  {
    reset,
    changed,
    started,
    target = element,
  }: {
    reset(): void;
    changed(): void;
    started(): void;
    target?: Element;
  },
) {
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  const touchAction = element.style.touchAction;
  const controls = new OrbitControls(camera, element as HTMLElement);
  const toUpright = new Quaternion().setFromUnitVectors(
    camera.up.clone().normalize(),
    new Vector3(0, 1, 0),
  );
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.mouseButtons.MIDDLE = MOUSE.PAN;
  controls.addEventListener('change', changed);
  controls.addEventListener('start', started);
  const gate = (event: Event) => {
    controls.enabled = target.contains(event.target as Node);
    if (controls.enabled && event.type === 'pointerdown')
      (target as HTMLElement).focus({ preventScroll: true });
  };
  if (target !== element) {
    element.addEventListener('pointerdown', gate, { ...listen, capture: true });
    element.addEventListener('wheel', gate, { ...listen, capture: true, passive: true });
  }
  element.addEventListener(
    'keydown',
    (input: Event) => {
      const event = input as KeyboardEvent;
      if (!target.contains(event.target as Node)) return;
      if (
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'Home'].includes(
          event.key,
        )
      )
        return;
      event.preventDefault();
      controls.enabled = true;
      if (event.key === 'Home') return reset();
      started();
      const offset = camera.position.clone().sub(controls.target);
      const sphere = new Spherical().setFromVector3(offset.clone().applyQuaternion(toUpright));
      const orthographic = 'isOrthographicCamera' in camera;
      if (['+', '=', '-', '_'].includes(event.key)) {
        const factor = ['+', '='].includes(event.key) ? 0.9 : 1.1;
        if (orthographic)
          camera.zoom = Math.max(
            controls.minZoom,
            Math.min(controls.maxZoom, camera.zoom / factor),
          );
        else offset.multiplyScalar(factor);
      } else if (event.shiftKey) {
        const extent = orthographic ? (camera.top - camera.bottom) / camera.zoom : offset.length();
        controls.target.add(
          new Vector3()
            .setFromMatrixColumn(
              camera.matrix,
              ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 0 : 1,
            )
            .multiplyScalar(
              extent * 0.04 * (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1),
            ),
        );
      } else {
        if (event.key === 'ArrowLeft') sphere.theta -= 0.12;
        if (event.key === 'ArrowRight') sphere.theta += 0.12;
        if (event.key === 'ArrowUp') sphere.phi -= 0.12;
        if (event.key === 'ArrowDown') sphere.phi += 0.12;
        sphere.phi = Math.max(controls.minPolarAngle, Math.min(controls.maxPolarAngle, sphere.phi));
        sphere.makeSafe();
        offset.setFromSpherical(sphere).applyQuaternion(toUpright.clone().invert());
      }
      offset.clampLength(controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset);
      camera.updateProjectionMatrix();
      controls.update();
      changed();
    },
    listen,
  );
  return {
    controls,
    dispose() {
      abort.abort();
      controls.removeEventListener('change', changed);
      controls.removeEventListener('start', started);
      controls.dispose();
      element.style.touchAction = touchAction;
    },
  };
}
