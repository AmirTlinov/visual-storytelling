export interface SceneFrameOptions {
  width: number;
  height: number;
}

/** A logical film canvas; the browser scales the complete composition as one unit. */
export function sceneFrame(stage: HTMLElement, { width, height }: SceneFrameOptions) {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0))
    throw new Error('Scene frame dimensions must be positive');
  const element = document.createElement('div');
  element.className = 've-frame';
  element.dataset.sceneFrame = '';
  element.style.aspectRatio = `${width} / ${height}`;
  stage.classList.add('ve-frame-content');
  Object.assign(stage.style, {
    width: `${width}px`,
    height: `${height}px`,
    transformOrigin: '0 0',
  });
  element.append(stage);
  const resize = () => {
    stage.style.transform = `scale(${element.clientWidth / width})`;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(element);
  return { element, resize, dispose: () => observer.disconnect() };
}
