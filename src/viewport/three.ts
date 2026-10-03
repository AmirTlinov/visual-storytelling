import type { Material, Texture, Color } from 'three';
type Palette = Record<string, Color>;
type ColorMaterial = Material & { color: Color };
type MaterialInk = string | ((palette: Palette) => Color);
import { projectedLabels, type LabelInsets } from './labels.js';
import { shotPose, type ShotTransition3D } from './shots.js';
import * as ThreeKit from './engine.js';
/* Camera, GPU resources and projected labels belong to this surface. */

function mount(
  stage: HTMLElement,
  {
    onInteract = () => {},
    label = 'Объёмная сцена',
    labelInsets = () => ({}),
  }: { onInteract?: () => void; label?: string; labelInsets?: () => LabelInsets } = {},
) {
  const T = ThreeKit,
    scene = new T.Scene();
  const camera = new T.PerspectiveCamera(36, 1, 0.01, 1000);
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NoToneMapping;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    `${label}. Левая кнопка и стрелки — вращение; средняя кнопка, Shift и левая кнопка или Shift и стрелки — перенос; колесо и плюс или минус — масштаб; Home — исходный вид.`,
  );
  stage.prepend(canvas);
  const controls = new T.OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.mouseButtons.MIDDLE = T.MOUSE.PAN;
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  const labels = projectedLabels(stage, camera, scene, ink, release, invalidate, labelInsets);
  const materials = new Map<ColorMaterial, MaterialInk>(),
    palette: Palette = {};
  let pending = 0,
    disposed = false,
    afterRender = () => {};
  let object: ThreeKit.Object3D | undefined,
    home: { position: ThreeKit.Vector3; target: ThreeKit.Vector3 } | undefined;
  let following = true,
    lastShot: ShotTransition3D | undefined;
  const hemisphere = new T.HemisphereLight(0xffffff, 0xb8c1c8, 2.4),
    light = new T.DirectionalLight(0xffffff, 2.2);
  light.position.set(-3, 5, 7);
  scene.add(hemisphere, light);
  function render() {
    pending = 0;
    if (disposed) return;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    labels.render();
    renderer.render(scene, camera);
    afterRender();
  }
  function invalidate() {
    if (!pending && !disposed) pending = requestAnimationFrame(render);
  }
  const changed = () => invalidate(),
    started = () => {
      following = false;
      onInteract();
    };
  controls.addEventListener('change', changed);
  controls.addEventListener('start', started);
  const sample = document.createElement('span');
  sample.hidden = true;
  stage.append(sample);
  const swatch = document.createElement('canvas');
  swatch.width = swatch.height = 1;
  const context = swatch.getContext('2d', { willReadFrequently: true })!;
  function theme() {
    sample.style.color = 'var(--ve-surface)';
    const surfaceColor = getComputedStyle(sample).color;
    for (const key of [
      'ink',
      'surface',
      'muted',
      'blue',
      'green',
      'purple',
      'orange',
      'red',
      'pencil',
      'blue-wash',
      'green-wash',
      'purple-wash',
      'orange-wash',
    ]) {
      sample.style.color = `var(--ve-${key})`;
      // Composite the same CSS wash on paper before Three converts it to linear RGB.
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = surfaceColor;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(sample).color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      palette[key] = new T.Color(`rgb(${r},${g},${b})`);
    }
    for (const [material, color] of materials)
      material.color.copy(typeof color === 'function' ? color(palette) : palette[color]!);
    invalidate();
  }
  function ink<M extends ColorMaterial>(material: M, color: MaterialInk = 'ink') {
    materials.set(material, color);
    if (palette.ink)
      material.color.copy(typeof color === 'function' ? color(palette) : palette[color]!);
    return material;
  }
  function resize() {
    const width = stage.clientWidth,
      height = stage.clientHeight;
    if (!width || !height) return;
    // Preserve the user's orbit and relative zoom as the narrow dimension changes.
    const aperture = (aspect: number) =>
      Math.sin(Math.atan(Math.tan((camera.fov * Math.PI) / 360) * Math.min(aspect, 1)));
    if (home) {
      const scale = aperture(camera.aspect) / aperture(width / height);
      camera.position.sub(controls.target).multiplyScalar(scale).add(controls.target);
      home.position.sub(home.target).multiplyScalar(scale).add(home.target);
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (following && lastShot) shot(lastShot);
    invalidate();
  }
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(stage);
  const themeObserver = new MutationObserver(theme);
  for (let ancestor: HTMLElement | null = stage; ancestor; ancestor = ancestor.parentElement)
    themeObserver.observe(ancestor, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', theme, listen);
  window.addEventListener('openai:set_globals', theme, listen);
  function fit(target = object) {
    if (!target) return;
    target.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(target),
      sphere = bounds.getBoundingSphere(new T.Sphere());
    const radius = Math.max(sphere.radius, 0.1);
    const halfFov = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * Math.min(camera.aspect, 1));
    const distance = (radius / Math.sin(halfFov)) * 1.14;
    controls.target.copy(sphere.center);
    camera.position
      .copy(sphere.center)
      .add(new T.Vector3(3.2, 2.0, 4.5).normalize().multiplyScalar(distance));
    camera.near = radius / 100;
    camera.far = distance + radius * 100;
    camera.updateProjectionMatrix();
    controls.minDistance = radius * 0.7;
    controls.maxDistance = radius * 30;
    home = { position: camera.position.clone(), target: controls.target.clone() };
    controls.update();
    invalidate();
  }
  function reset() {
    following = true;
    if (lastShot) return shot(lastShot);
    if (home) {
      camera.position.copy(home.position);
      controls.target.copy(home.target);
      controls.update();
      invalidate();
    }
  }
  function shot(options: ShotTransition3D) {
    lastShot = options;
    if (!following || !stage.clientWidth || !stage.clientHeight) return;
    const pose = shotPose(camera, stage.clientWidth, stage.clientHeight, {
      ...options,
      reduced: options.reduced ?? matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    camera.position.copy(pose.position);
    controls.target.copy(pose.target);
    camera.near = pose.near;
    camera.far = pose.far;
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  }
  canvas.addEventListener(
    'keydown',
    (event) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'Home'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      started();
      if (event.key === 'Home') {
        reset();
        return;
      }
      const offset = camera.position.clone().sub(controls.target),
        sphere = new T.Spherical().setFromVector3(offset);
      if (event.key === '+' || event.key === '=') offset.multiplyScalar(0.9);
      else if (event.key === '-' || event.key === '_') offset.multiplyScalar(1.1);
      else if (event.shiftKey) {
        const move = new T.Vector3()
          .setFromMatrixColumn(
            camera.matrix,
            ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 0 : 1,
          )
          .multiplyScalar(
            offset.length() * 0.04 * (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1),
          );
        controls.target.add(move);
      } else {
        if (event.key === 'ArrowLeft') sphere.theta -= 0.12;
        if (event.key === 'ArrowRight') sphere.theta += 0.12;
        if (event.key === 'ArrowUp') sphere.phi -= 0.12;
        if (event.key === 'ArrowDown') sphere.phi += 0.12;
        sphere.makeSafe();
        offset.setFromSpherical(sphere);
      }
      offset.clampLength(controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      invalidate();
    },
    listen,
  );
  function release(target?: ThreeKit.Object3D) {
    const geometries = new Set<ThreeKit.BufferGeometry>(),
      mats = new Set<Material>(),
      textures = new Set<Texture>();
    target?.traverse((node) => {
      const n = node as ThreeKit.Mesh;
      if (n.geometry) geometries.add(n.geometry);
      for (const m of Array.isArray(n.material) ? n.material : n.material ? [n.material] : [])
        mats.add(m);
    });
    for (const m of mats) {
      for (const value of Object.values(m))
        if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture)
          textures.add(value as Texture);
      materials.delete(m as ColorMaterial);
      m.dispose();
    }
    for (const value of [...textures, ...geometries]) value.dispose();
  }
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      stage.setAttribute('aria-busy', 'true');
    },
    listen,
  );
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      stage.removeAttribute('aria-busy');
      invalidate();
    },
    listen,
  );
  resize();
  theme();
  return {
    scene,
    camera,
    controls,
    renderer,
    palette,
    ink,
    invalidate,
    fit,
    reset,
    shot,
    get following() {
      return following;
    },
    setObject(next: ThreeKit.Object3D, { fitView = true } = {}) {
      if (object === next) return;
      if (object) {
        scene.remove(object);
        release(object);
      }
      object = next;
      scene.add(next);
      if (fitView) fit(next);
      invalidate();
    },
    label: labels.label,
    async loadGLB(source: string | ArrayBuffer) {
      const loader = new T.GLTFLoader();
      const result =
        source instanceof ArrayBuffer
          ? await loader.parseAsync(source, '')
          : await loader.loadAsync(source);
      return result;
    },
    onRender(callback: () => void) {
      afterRender = callback;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(pending);
      abort.abort();
      controls.removeEventListener('change', changed);
      controls.removeEventListener('start', started);
      controls.dispose();
      sizeObserver.disconnect();
      themeObserver.disconnect();
      release(object);
      renderer.dispose();
      labels.dispose();
      canvas.remove();
      sample.remove();
    },
  };
}
export const Viewport3D = { mount };
