import { releaseResources } from '../lifecycle.js';
import { registerRaster } from '../export/raster.js';
import type { Material, Texture, Color } from 'three';
import { pigments } from '../ink/palette.js';
import { attachInspection } from './inspection.js';
import { semanticObjects3D } from './semantics.js';
type Palette = Record<string, Color>;
type ColorMaterial = Material & { color: Color };
/** A derived pigment is resolved on each invalidated frame and on theme changes. */
type MaterialInk = string | ((palette: Palette) => Color);
import { projectedLabels, type LabelInsets } from './labels.js';
import { cameraView3D } from './camera-view.js';
export type { CameraShot } from './camera-view.js';
import * as ThreeKit from './engine.js';
import { orbitControls, orbitHelp } from './orbit.js';
/* Camera, GPU resources and projected labels belong to this surface. */

function mount(
  stage: HTMLElement,
  {
    onInteract = () => {},
    label = 'Объёмная сцена',
    labelInsets = () => ({}),
    labelObstacles = () => [],
    up = [0, 1, 0],
  }: {
    onInteract?: () => void;
    label?: string;
    labelInsets?: () => LabelInsets;
    /** Projected geometry that screen annotations must leave readable. Surface lettering is automatic. */
    labelObstacles?: () => readonly (ThreeKit.Object3D | ThreeKit.Box3)[];
    up?: readonly [number, number, number];
  } = {},
) {
  let gltf: Promise<ReturnType<(typeof import('./gltf.js'))['gltfLoader']>> | undefined;
  const T = ThreeKit,
    scene = new T.Scene();
  const camera = new T.PerspectiveCamera(36, 1, 0.01, 1000);
  if (up.length !== 3 || !up.every(Number.isFinite) || Math.hypot(...up) === 0)
    throw new Error('A viewport needs a finite nonzero up vector');
  camera.up.set(...up).normalize();
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NoToneMapping;
  const canvas = renderer.domElement;
  // A viewport can live inside a bounded pane, beyond SceneShell's direct-child
  // styles. CSS layout stays in host pixels; the drawing buffer owns density.
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%' });
  let frameSequence = 0,
    renderedAt = 0;
  const detachInspection = attachInspection(canvas, scene, camera, () => ({
    frameSequence,
    renderedAt,
    clock: 'performance.now after renderer.render; display presentation unknown',
  }));
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${label}. ${orbitHelp}`);
  stage.prepend(canvas);
  const orbit = orbitControls(camera, canvas, {
    reset: () => cameraOwner.reset({ animate: true }),
    changed: () => invalidate(),
    started: () => started(),
  });
  const { controls } = orbit;
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  const labels = projectedLabels(
    stage,
    camera,
    scene,
    ink,
    release,
    invalidate,
    labelInsets,
    labelObstacles,
  );
  const subjects = semanticObjects3D(stage, canvas, scene, camera, invalidate);
  const materials = new Map<ColorMaterial, MaterialInk>(),
    palette: Palette = {};
  const cleanups = new Set<() => void>();
  cleanups.add(
    registerRaster(canvas, () => {
      if (disposed || renderer.getContext().isContextLost())
        throw new Error('3D viewport is unavailable.');
      // Copy the accepted scene without advancing its camera or model clocks.
      renderer.render(scene, camera);
      return canvas.toDataURL();
    }),
  );
  const removals = new Set<(object: ThreeKit.Object3D) => void>();
  const renderListeners = new Set<() => void>();
  const paintWaiters = new Set<(failed: boolean, cause?: unknown) => void>();
  let renderFailure: { cause: unknown } | undefined;
  let pending = 0,
    disposed = false;
  let object: ThreeKit.Object3D | undefined;
  const cameraOwner = cameraView3D({
    stage,
    camera,
    controls,
    labels,
    invalidate,
    subjectIds: () => subjects.ids(),
  });
  const hemisphere = new T.HemisphereLight(0xffffff, 0xb8c1c8, 2.4),
    light = new T.DirectionalLight(0xffffff, 2.2);
  light.position.set(-3, 5, 7);
  scene.add(hemisphere, light);
  function render() {
    pending = 0;
    if (disposed) return;
    try {
      if (renderer.getContext().isContextLost())
        throw new Error('3D viewport context has been lost');
      cameraOwner.frame();
      for (const [material, color] of materials)
        if (typeof color === 'function') material.color.copy(materialColor(color));
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      labels.render();
      subjects.render();
      renderer.render(scene, camera);
      if (renderer.getContext().isContextLost())
        throw new Error('3D viewport context has been lost');
      frameSequence++;
      renderedAt = performance.now();
      renderFailure = undefined;
    } catch (cause) {
      renderFailure = { cause };
      const awaited = paintWaiters.size > 0;
      for (const waiter of [...paintWaiters]) waiter(true, cause);
      if (!awaited) throw cause;
      return;
    }
    for (const waiter of [...paintWaiters]) waiter(false);
    for (const listener of renderListeners) listener();
  }
  function invalidate() {
    if (!pending && !disposed) pending = requestAnimationFrame(render);
  }
  const started = () => {
    cameraOwner.manual();
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
  let raster: { width: number; height: number; ratio: number } | undefined;
  function resizeRaster() {
    const width = stage.clientWidth,
      height = stage.clientHeight;
    if (!width || !height) return;
    // The composition can change scale without changing its logical layout.
    // Rasterize at the displayed density while keeping the camera in layout pixels.
    const bounds = stage.getBoundingClientRect();
    const scale = Math.max(bounds.width / width, bounds.height / height);
    const ratio = Math.min(
      Math.min(devicePixelRatio || 1, 2) * Math.max(scale, 0.01),
      renderer.capabilities.maxTextureSize / width,
      renderer.capabilities.maxTextureSize / height,
    );
    if (raster?.width === width && raster.height === height && raster.ratio === ratio) return;
    raster = { width, height, ratio };
    renderer.setDrawingBufferSize(width, height, ratio);
    invalidate();
  }
  function resize() {
    cameraOwner.resize();
    resizeRaster();
  }
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(stage);
  window.addEventListener(
    'scene-frame-resize',
    (event) => {
      if (event.target instanceof Element && event.target.contains(stage)) resizeRaster();
    },
    listen,
  );
  const themeObserver = new MutationObserver(theme);
  for (let ancestor: HTMLElement | null = stage; ancestor; ancestor = ancestor.parentElement)
    themeObserver.observe(ancestor, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', theme, listen);
  function fit(target = object) {
    cameraOwner.fit(target);
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
    releaseResources(
      [
        ...[...removed.mats]
          .filter((m) => !retained.mats.has(m))
          .map((m) => () => {
            materials.delete(m as ColorMaterial);
            m.dispose();
          }),
        ...[...removed.textures]
          .filter((texture) => !retained.textures.has(texture))
          .map((texture) => () => texture.dispose()),
        ...[...removed.geometries]
          .filter((geometry) => !retained.geometries.has(geometry))
          .map((geometry) => () => geometry.dispose()),
      ],
      '3D subject resource disposal failed.',
    );
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
    describe: subjects.describe,
    validateFocus: subjects.validate,
    focus(ids: readonly string[]) {
      const target = subjects.bounds(ids);
      // Explicit focus is a view exploration, just like an orbit gesture. Keep
      // the authored shot so returning to Story restores its current viewpoint.
      cameraOwner.focus(target);
    },
    scene,
    camera,
    controls,
    renderer,
    palette,
    ink,
    invalidate,
    fit,
    reset: cameraOwner.reset,
    shot: cameraOwner.shot,
    get following() {
      return cameraOwner.following;
    },
    get transition() {
      return cameraOwner.transition;
    },
    capture: cameraOwner.capture,
    restore: cameraOwner.restore,
    setObject(next: ThreeKit.Object3D, { fitView = true } = {}) {
      if (object === next) return;
      next.removeFromParent();
      scene.add(next);
      let retained = false;
      for (let node = object; node; node = node.parent ?? undefined)
        if (node === next) retained = true;
      if (object && !retained) {
        subjects.remove(object);
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
      if (disposed) throw new Error('3D viewport has been disposed');
      const owner = await (gltf ??= import('./gltf.js').then((module) => module.gltfLoader()));
      if (disposed) {
        owner.dispose();
        throw new Error('3D viewport has been disposed');
      }
      const { loader } = owner;
      const result =
        source instanceof ArrayBuffer
          ? await loader.parseAsync(source, '')
          : await loader.loadAsync(source);
      if (disposed) {
        release(result.scene);
        throw new Error('3D viewport has been disposed');
      }
      return result;
    },
    onRender(callback: () => void) {
      if (disposed) throw new Error('3D viewport has been disposed');
      renderListeners.add(callback);
      return () => {
        renderListeners.delete(callback);
      };
    },
    /** Flush pending GPU work through this renderer, including concealed preparation without RAF. */
    whenRendered(signal?: AbortSignal): Promise<number> {
      if (disposed) return Promise.reject(new Error('3D viewport has been disposed'));
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (renderer.getContext().isContextLost())
        return Promise.reject(new Error('3D viewport context has been lost'));
      if (!pending && renderFailure) return Promise.reject(renderFailure.cause);
      if (!pending && frameSequence) return Promise.resolve(frameSequence);
      return new Promise((resolve, reject) => {
        const finish = (failed: boolean, error?: unknown) => {
          paintWaiters.delete(finish);
          cleanups.delete(released);
          signal?.removeEventListener('abort', aborted);
          failed ? reject(error) : resolve(frameSequence);
        };
        const released = () => finish(true, new Error('3D viewport has been disposed'));
        const aborted = () => finish(true, signal?.reason);
        paintWaiters.add(finish);
        cleanups.add(released);
        signal?.addEventListener('abort', aborted, { once: true });
        invalidate();
        // Concealed iframes can suspend RAF. Explicit preparation still needs a
        // GPU frame; one cancellable microtask flushes the same pending owner.
        queueMicrotask(() => {
          if (disposed || !pending || !paintWaiters.size) return;
          cancelAnimationFrame(pending);
          pending = 0;
          render();
        });
      });
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
      cameraOwner.dispose();
      renderListeners.clear();
      void gltf?.then(
        (owner) => owner.dispose(),
        () => {},
      );
      const resources = [
        ...cleanups,
        () => cancelAnimationFrame(pending),
        () => abort.abort(),
        () => orbit.dispose(),
        () => sizeObserver.disconnect(),
        () => themeObserver.disconnect(),
        () => labels.dispose(),
        () => subjects.dispose(),
        () => release(scene),
        () => materials.clear(),
        detachInspection,
        () => renderer.dispose(),
        () => renderer.forceContextLoss(),
        () => canvas.remove(),
        () => sample.remove(),
      ];
      cleanups.clear();
      removals.clear();
      releaseResources(resources, '3D viewport disposal failed.');
    },
  };
}
export const Viewport3D = { mount };
export type Viewport3DHandle = Awaited<ReturnType<typeof mount>>;
