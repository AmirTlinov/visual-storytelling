import type { Material, Texture, Color } from 'three';
import { pigments } from '../ink/palette.js';
import { attachInspection } from './inspection.js';
import { semanticObjects3D } from './semantics.js';
type Palette = Record<string, Color>;
type ColorMaterial = Material & { color: Color };
/** A derived pigment is resolved on each invalidated frame and on theme changes. */
type MaterialInk = string | ((palette: Palette) => Color);
import { projectedLabels, type LabelInsets } from './labels.js';
import { shotPose, type Shot3D, type ShotTransition3D } from './shots.js';
import * as ThreeKit from './engine.js';
import { orbitControls, orbitHelp } from './orbit.js';
import type { SceneView } from '../scene-checkpoint.js';
/* Camera, GPU resources and projected labels belong to this surface. */
/** A custom projection uses the same resize/reset owner as a fitted shot. */
export type CameraShot =
  | ShotTransition3D
  | ((camera: ThreeKit.PerspectiveCamera, width: number, height: number) => void);

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
    reset: () => reset({ animate: true }),
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
  const removals = new Set<(object: ThreeKit.Object3D) => void>();
  const renderListeners = new Set<() => void>();
  let pending = 0,
    disposed = false;
  let object: ThreeKit.Object3D | undefined,
    home: { position: ThreeKit.Vector3; target: ThreeKit.Vector3 } | undefined;
  let following = true,
    lastShot: CameraShot | undefined;
  let returning:
    | {
        start: number;
        from: { position: ThreeKit.Vector3; target: ThreeKit.Vector3 };
        to: { position: ThreeKit.Vector3; target: ThreeKit.Vector3 };
        near: number;
        far: number;
        minDistance: number;
        maxDistance: number;
      }
    | undefined;
  const hemisphere = new T.HemisphereLight(0xffffff, 0xb8c1c8, 2.4),
    light = new T.DirectionalLight(0xffffff, 2.2);
  light.position.set(-3, 5, 7);
  scene.add(hemisphere, light);
  function render() {
    pending = 0;
    if (disposed) return;
    if (returning) {
      const movement = returning;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const progress = reduced ? 1 : Math.min(1, (performance.now() - movement.start) / 240);
      const amount = progress * progress * (3 - 2 * progress);
      const from = movement.from.position.clone().sub(movement.from.target);
      const to = movement.to.position.clone().sub(movement.to.target);
      const distance = Math.exp(
        Math.log(from.length()) * (1 - amount) + Math.log(to.length()) * amount,
      );
      const turn = new T.Quaternion().setFromUnitVectors(
        from.clone().normalize(),
        to.clone().normalize(),
      );
      const offset = from
        .normalize()
        .applyQuaternion(new T.Quaternion().slerp(turn, amount))
        .multiplyScalar(distance);
      if (progress === 1) {
        camera.position.copy(movement.to.position);
        controls.target.copy(movement.to.target);
        controls.minDistance = movement.minDistance;
        controls.maxDistance = movement.maxDistance;
      } else {
        controls.target.copy(movement.from.target).lerp(movement.to.target, amount);
        camera.position.copy(controls.target).add(offset);
      }
      controls.update();
      if (progress < 1) invalidate();
      else {
        returning = undefined;
        camera.near = movement.near;
        camera.far = movement.far;
        camera.updateProjectionMatrix();
      }
    }
    for (const [material, color] of materials)
      if (typeof color === 'function') material.color.copy(materialColor(color));
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    labels.render();
    subjects.render();
    renderer.render(scene, camera);
    frameSequence++;
    renderedAt = performance.now();
    for (const listener of renderListeners) listener();
  }
  function invalidate() {
    if (!pending && !disposed) pending = requestAnimationFrame(render);
  }
  const started = () => {
    returning = undefined;
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
      if (returning)
        for (const pose of [returning.from, returning.to])
          pose.position.sub(pose.target).multiplyScalar(scale).add(pose.target);
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    resizeRaster();
    if (following && lastShot) shot(lastShot);
    invalidate();
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
  window.addEventListener('openai:set_globals', theme, listen);
  function fit(target = object) {
    if (!target) return;
    returning = undefined;
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
  function reset({ animate = false, from: origin }: Parameters<SceneView['reset']>[0] = {}) {
    const saved = origin as { kind?: string; position?: number[]; target?: number[] } | undefined;
    const compatible =
      saved?.kind === 'three' &&
      saved.position?.length === 3 &&
      saved.target?.length === 3 &&
      [...saved.position, ...saved.target].every(Number.isFinite);
    const from = {
      position: compatible ? new T.Vector3(...saved.position!) : camera.position.clone(),
      target: compatible ? new T.Vector3(...saved.target!) : controls.target.clone(),
    };
    const previousNear = camera.near,
      previousFar = camera.far;
    returning = undefined;
    following = true;
    if (lastShot) shot(lastShot);
    else if (home) {
      camera.position.copy(home.position);
      controls.target.copy(home.target);
      controls.update();
      invalidate();
    }
    if (
      animate &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !(lastShot && typeof lastShot !== 'function' && lastShot.reduced) &&
      typeof lastShot !== 'function' &&
      from.position.distanceToSquared(from.target) > 1e-12 &&
      camera.position.distanceToSquared(controls.target) > 1e-12 &&
      (from.position.distanceToSquared(camera.position) > 1e-12 ||
        from.target.distanceToSquared(controls.target) > 1e-12)
    ) {
      returning = {
        start: performance.now(),
        from,
        to: { position: camera.position.clone(), target: controls.target.clone() },
        near: camera.near,
        far: camera.far,
        minDistance: controls.minDistance,
        maxDistance: controls.maxDistance,
      };
      camera.position.copy(from.position);
      controls.target.copy(from.target);
      camera.near = Math.min(previousNear, camera.near);
      camera.far = Math.max(previousFar, camera.far);
      const distance = from.position.distanceTo(from.target);
      controls.minDistance = Math.min(controls.minDistance, distance);
      controls.maxDistance = Math.max(controls.maxDistance, distance);
      camera.updateProjectionMatrix();
      controls.update();
      invalidate();
    }
  }
  function shot(options: CameraShot) {
    lastShot = options;
    if (following) applyShot(options);
  }
  function applyShot(options: CameraShot) {
    const width = stage.clientWidth,
      height = stage.clientHeight;
    if (!width || !height) return;
    if (typeof options === 'function') {
      returning = undefined;
      options(camera, width, height);
      invalidate();
      return;
    }
    const anchors = (shot: Shot3D) => [
      ...labels.anchors(shot.target, shot.bounds !== undefined),
      ...(shot.anchors ?? []),
    ];
    const pose = shotPose(camera, width, height, {
      ...options,
      anchors: anchors(options),
      from: options.from && { ...options.from, anchors: anchors(options.from) },
      reduced: options.reduced ?? matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    if (returning) {
      returning.to.position.copy(pose.position);
      returning.to.target.copy(pose.target);
      returning.near = pose.near;
      returning.far = pose.far;
      camera.near = Math.min(camera.near, pose.near);
      camera.far = Math.max(camera.far, pose.far);
    } else {
      camera.position.copy(pose.position);
      controls.target.copy(pose.target);
      camera.near = pose.near;
      camera.far = pose.far;
    }
    // Orbit limits follow the subject of this shot, including a tiny part of a large scene.
    const minDistance = pose.radius * 0.7;
    const maxDistance = Math.max(pose.radius * 30, pose.position.distanceTo(pose.target) * 4);
    if (returning) {
      returning.minDistance = minDistance;
      returning.maxDistance = maxDistance;
      controls.minDistance = Math.min(controls.minDistance, minDistance);
      controls.maxDistance = Math.max(controls.maxDistance, maxDistance);
    } else {
      controls.minDistance = minDistance;
      controls.maxDistance = maxDistance;
    }
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
    describe: subjects.describe,
    validateFocus: subjects.validate,
    focus(ids: readonly string[]) {
      const target = subjects.bounds(ids);
      // Explicit focus is a view exploration, just like an orbit gesture. Keep
      // the authored shot so returning to Story restores its current viewpoint.
      returning = undefined;
      following = false;
      applyShot({ target, padding: 36 });
    },
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
    get transition() {
      return returning ? ('running' as const) : ('idle' as const);
    },
    capture() {
      return {
        kind: 'three',
        following,
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        aspect: camera.aspect,
        subjects: subjects.ids(),
      };
    },
    restore(value: unknown) {
      const state = value as {
        kind?: string;
        following?: boolean;
        position?: number[];
        target?: number[];
        aspect?: number;
        subjects?: string[];
      };
      if (
        state?.kind !== 'three' ||
        typeof state.following !== 'boolean' ||
        !state.position ||
        !state.target ||
        state.position.length !== 3 ||
        state.target.length !== 3 ||
        ![...state.position, ...state.target].every(Number.isFinite)
      )
        return false;
      if (state.subjects?.length && !state.subjects.some((id) => subjects.ids().includes(id)))
        return false;
      if (state.following) {
        reset();
        return true;
      }
      returning = undefined;
      following = false;
      camera.position.fromArray(state.position);
      controls.target.fromArray(state.target);
      if (state.aspect && Number.isFinite(state.aspect) && state.aspect > 0) {
        const aperture = (aspect: number) =>
          Math.sin(Math.atan(Math.tan((camera.fov * Math.PI) / 360) * Math.min(aspect, 1)));
        camera.position
          .sub(controls.target)
          .multiplyScalar(aperture(state.aspect) / aperture(camera.aspect))
          .add(controls.target);
      }
      controls.update();
      invalidate();
      return true;
    },
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
      returning = undefined;
      lastShot = undefined;
      renderListeners.clear();
      void gltf?.then(
        (owner) => owner.dispose(),
        () => {},
      );
      for (const cleanup of [...cleanups]) cleanup();
      cleanups.clear();
      removals.clear();
      cancelAnimationFrame(pending);
      abort.abort();
      orbit.dispose();
      sizeObserver.disconnect();
      themeObserver.disconnect();
      labels.dispose();
      subjects.dispose();
      release(scene);
      materials.clear();
      detachInspection();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      sample.remove();
    },
  };
}
export const Viewport3D = { mount };
export type Viewport3DHandle = Awaited<ReturnType<typeof mount>>;
