import { OrthographicCamera, Vector3 } from './engine.js';
import { orbitControls, orbitHelp } from './orbit.js';
import { svg as element } from '../ink/dom.js';

export interface SvgOrbitPose {
  yaw: number;
  pitch: number;
  zoom: number;
  pan: readonly [number, number];
}

let nextClip = 0;

/** Orthographic camera for an existing SVG projection; subject geometry remains in the scene. */
function mount(
  svg: SVGSVGElement,
  stage: SVGGElement,
  world: SVGGElement,
  options: {
    yaw: number;
    pitch: number;
    pitchLimits?: readonly [number, number];
    changed(pose: SvgOrbitPose): void;
    select?(target: Element): void;
  },
) {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  const oldLabel = stage.getAttribute('aria-label') ?? '';
  const touchAction = svg.style.touchAction;
  const clipID = `ve-orbit-clip-${++nextClip}`;
  const clip = element('clipPath', { id: clipID });
  const clipRect = element('rect');
  clip.append(clipRect);
  const frame = element('g', { 'clip-path': `url(#${clipID})` });
  world.before(clip, frame);
  frame.append(world);
  stage.setAttribute('aria-label', `${oldLabel} ${orbitHelp}`);
  const position = () =>
    camera.position.set(
      -10 * Math.cos(options.pitch) * Math.sin(options.yaw),
      -10 * Math.sin(options.pitch),
      10 * Math.cos(options.pitch) * Math.cos(options.yaw),
    );
  position();
  let pose: SvgOrbitPose = { yaw: options.yaw, pitch: options.pitch, zoom: 1, pan: [0, 0] };
  const orbit = orbitControls(camera, svg, {
    target: stage,
    reset,
    changed,
    started: () => {},
  });
  const { controls } = orbit;
  // The model's group owns touch gestures; the rest of a long SVG stays scrollable.
  svg.style.touchAction = touchAction;
  controls.minPolarAngle = Math.PI / 2 + (options.pitchLimits?.[0] ?? -1.4);
  controls.maxPolarAngle = Math.PI / 2 + (options.pitchLimits?.[1] ?? 1.4);
  controls.minZoom = 0.5;
  controls.maxZoom = 4;
  const started = () => stage.classList.add('dragging');
  const ended = () => stage.classList.remove('dragging');
  controls.addEventListener('start', started);
  controls.addEventListener('end', ended);
  function changed() {
    camera.updateMatrixWorld(true);
    const offset = camera.position.clone().sub(controls.target);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const pan: [number, number] = [
      -controls.target.dot(right) * camera.zoom,
      controls.target.dot(up) * camera.zoom,
    ];
    pose = {
      yaw: -Math.atan2(offset.x, offset.z),
      pitch: Math.asin(-offset.y / offset.length()),
      zoom: camera.zoom,
      pan,
    };
    const box = stage.querySelector('rect')!.getBBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    world.setAttribute(
      'transform',
      `translate(${x + pan[0]} ${y + pan[1]}) scale(${camera.zoom}) translate(${-x} ${-y})`,
    );
    options.changed(pose);
  }
  function resize() {
    const box = svg.viewBox.baseVal;
    camera.left = -box.width / 2;
    camera.right = box.width / 2;
    camera.top = box.height / 2;
    camera.bottom = -box.height / 2;
    const area = stage.querySelector('rect')!.getBoundingClientRect();
    const region = stage.querySelector('rect')!.getBBox();
    for (const key of ['x', 'y', 'width', 'height'] as const)
      clipRect.setAttribute(key, String(region[key]));
    controls.rotateSpeed = svg.clientHeight / Math.max(1, area.height);
    camera.updateProjectionMatrix();
    changed();
  }
  function reset() {
    controls.target.set(0, 0, 0);
    camera.zoom = 1;
    position();
    camera.updateProjectionMatrix();
    controls.update();
    changed();
  }
  let press: { id: number; x: number; y: number; target: Element; moved: boolean } | undefined;
  svg.addEventListener(
    'pointerdown',
    (event) => {
      if (press) {
        press.moved = true;
        return;
      }
      if (event.button !== 0 || event.shiftKey || !stage.contains(event.target as Node)) return;
      press = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        target: event.target as Element,
        moved: false,
      };
    },
    { ...listen, capture: true },
  );
  svg.addEventListener(
    'pointermove',
    (event) => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3)
        press.moved = true;
    },
    listen,
  );
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
    svg.addEventListener(
      type,
      (event) => {
        if (!press || press.id !== event.pointerId) return;
        const ended = press;
        press = undefined;
        if (type === 'pointerup' && !ended.moved) options.select?.(ended.target);
      },
      { ...listen, capture: true },
    );
  const observer = new ResizeObserver(resize);
  observer.observe(svg);
  const layout = new MutationObserver(resize);
  layout.observe(svg, { attributes: true, attributeFilter: ['viewBox'] });
  resize();
  return {
    reset,
    get pose() {
      return pose;
    },
    dispose() {
      abort.abort();
      observer.disconnect();
      layout.disconnect();
      controls.removeEventListener('start', started);
      controls.removeEventListener('end', ended);
      orbit.dispose();
      stage.classList.remove('dragging');
      stage.setAttribute('aria-label', oldLabel);
      world.removeAttribute('transform');
      frame.before(world);
      frame.remove();
      clip.remove();
    },
  };
}
export const SvgOrbit = { mount };
