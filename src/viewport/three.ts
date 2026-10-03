import type { Material, Texture, Color } from 'three';
import { pigments } from '../ink/palette.js';
type Palette = Record<string, Color>;
type ColorMaterial = Material & { color: Color };
/** A derived pigment is resolved on each invalidated frame and on theme changes. */
type MaterialInk = string | ((palette: Palette) => Color);
import { projectedLabels, type LabelInsets } from './labels.js';
import { shotPose, type ShotTransition3D } from './shots.js';
import * as ThreeKit from './engine.js';
import { orbitControls, orbitHelp } from './orbit.js';
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
  canvas.setAttribute('aria-label', `${label}. ${orbitHelp}`);
  stage.prepend(canvas);
  const orbit = orbitControls(camera, canvas, {
    reset,
    changed: () => invalidate(),
    started: () => started(),
  });
  const { controls } = orbit;
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  const labels = projectedLabels(stage, camera, scene, ink, release, invalidate, labelInsets);
  const materials = new Map<ColorMaterial, MaterialInk>(),
    palette: Palette = {};
  const cleanups = new Set<() => void>();
  const removals = new Set<(object: ThreeKit.Object3D) => void>();
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
    for (const [material, color] of materials)
      if (typeof color === 'function') material.color.copy(materialColor(color));
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    labels.render();
    renderer.render(scene, camera);
    afterRender();
  }
  function invalidate() {
    if (!pending && !disposed) pending = requestAnimationFrame(render);
  }
  const started = () => {
    following = false;
    onInteract();
  };
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
      'surface',
      'muted',
      'pencil',
      ...Object.keys(pigments).flatMap((key) =>
        key === 'ink' ? [key] : [key, `${key}-wash`, `${key}-soft`],
      ),
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
    for (const [material, color] of materials) material.color.copy(materialColor(color));
    invalidate();
  }
  function materialColor(color: MaterialInk) {
    const value = typeof color === 'function' ? color(palette) : palette[color];
    if (!value)
      throw new Error(
        `Unknown 3D pigment: ${String(color)}. Choose ${Object.keys(palette).join(', ')}`,
      );
    return value;
  }
  function ink<M extends ColorMaterial>(material: M, color: MaterialInk = 'ink') {
    if (palette.ink) material.color.copy(materialColor(color));
    if (!materials.has(material))
      material.addEventListener('dispose', () => materials.delete(material));
    materials.set(material, color);
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
    lastShot = undefined;
    following = true;
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
    // Orbit limits follow the subject of this shot, including a tiny part of a large scene.
    controls.minDistance = pose.radius * 0.7;
    controls.maxDistance = Math.max(pose.radius * 30, pose.position.distanceTo(pose.target) * 4);
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  }
  function resources(target?: ThreeKit.Object3D, exclude?: ThreeKit.Object3D) {
    const geometries = new Set<ThreeKit.BufferGeometry>(),
      mats = new Set<Material>(),
      textures = new Set<Texture>();
    const collect = (node: ThreeKit.Object3D) => {
      if (node === exclude) return;
      const n = node as ThreeKit.Mesh;
      if (n.geometry) geometries.add(n.geometry);
      for (const m of Array.isArray(n.material) ? n.material : n.material ? [n.material] : [])
        mats.add(m);
      // A scene background or environment can also retain a material's texture.
      for (const value of Object.values(node))
        if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture)
          textures.add(value as Texture);
      node.children.forEach(collect);
    };
    if (target) collect(target);
    for (const m of mats)
      for (const value of Object.values(m))
        if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture)
          textures.add(value as Texture);
    return { geometries, mats, textures };
  }
  function release(target?: ThreeKit.Object3D) {
    const removed = resources(target),
      retained = resources(scene, target);
    for (const m of removed.mats) {
      if (retained.mats.has(m)) continue;
      materials.delete(m as ColorMaterial);
      m.dispose();
    }
    for (const texture of removed.textures) if (!retained.textures.has(texture)) texture.dispose();
    for (const geometry of removed.geometries)
      if (!retained.geometries.has(geometry)) geometry.dispose();
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
      next.removeFromParent();
      scene.add(next);
      let retained = false;
      for (let node = object; node; node = node.parent ?? undefined)
        if (node === next) retained = true;
      if (object && !retained) {
        labels.dispose(object);
        for (const remove of [...removals]) remove(object);
        object.removeFromParent();
        release(object);
      }
      object = next;
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
    onDispose(cleanup: () => void) {
      if (disposed) throw new Error('3D viewport has been disposed');
      cleanups.add(cleanup);
      return () => {
        cleanups.delete(cleanup);
      };
    },
    beforeRemove(cleanup: (object: ThreeKit.Object3D) => void) {
      if (disposed) throw new Error('3D viewport has been disposed');
      removals.add(cleanup);
      return () => {
        removals.delete(cleanup);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of [...cleanups]) cleanup();
      cleanups.clear();
      removals.clear();
      cancelAnimationFrame(pending);
      abort.abort();
      orbit.dispose();
      sizeObserver.disconnect();
      themeObserver.disconnect();
      labels.dispose();
      release(scene);
      materials.clear();
      renderer.dispose();
      canvas.remove();
      sample.remove();
    },
  };
}
export const Viewport3D = { mount };
