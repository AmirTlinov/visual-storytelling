import { player } from '../controls/player.js';
import { chapterNavigation } from '../story/chapters.js';
import type { Story, StoryStatus } from '../story/story.js';
import type { CaptionTrack } from '../story/captions.js';
import { releaseResources } from '../lifecycle.js';

/** Prepare controls offscreen; publish their DOM and subscriptions as one binding. */
export function controllerView<P, K extends string, S>(
  controller: Story<P, K, S>,
  options: {
    root: HTMLElement;
    stage: HTMLElement;
    controls: HTMLElement;
    heading: HTMLHeadingElement;
    caption: HTMLElement;
    track: CaptionTrack;
    title: string;
    navigation: boolean;
    headingLabel?: string;
    onPlay(): void;
    onSeek(): void;
    onState(state: StoryStatus<P, S>): void;
  },
) {
  const staging = document.createElement('div'),
    heading = document.createElement('h1'),
    caption = document.createElement('p');
  heading.textContent = options.title;
  heading.title = options.title;
  staging.append(heading);
  const cleanups: (() => void)[] = [];
  let active = false,
    latest: StoryStatus<P, S> | undefined;
  let chapters: ReturnType<typeof chapterNavigation>;
  try {
    const ui = player(staging, {
      transport: controller.player,
      captions: {
        get element() {
          return active ? options.caption : caption;
        },
        track: options.track,
      },
      onSeek: controller.seek,
      onPlay: options.onPlay,
    });
    cleanups.push(ui.dispose);
    chapters = chapterNavigation(
      heading,
      controller.sheet.script.segments ?? [],
      (time) => controller.seek(time, { mode: 'story' }),
      options.navigation,
      options.headingLabel,
    );
    cleanups.push(() => chapters.dispose());
    cleanups.push(controller.onSeek(options.onSeek));
    let frame = 0,
      width = options.stage.clientWidth,
      height = options.stage.clientHeight;
    const requestLayout = () => {
      if (!active || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        controller.update();
      });
    };
    const observer = new ResizeObserver(() => {
      const nextWidth = options.stage.clientWidth,
        nextHeight = options.stage.clientHeight;
      if (width === nextWidth && height === nextHeight) return;
      width = nextWidth;
      height = nextHeight;
      requestLayout();
    });
    observer.observe(options.stage);
    options.root.addEventListener('scene-frame-resize', requestLayout);
    cleanups.push(
      () => observer.disconnect(),
      () => options.root.removeEventListener('scene-frame-resize', requestLayout),
      () => cancelAnimationFrame(frame),
    );
    cleanups.push(
      controller.subscribe((state) => {
        latest = state;
        chapters.update(state.presented?.chapter);
        if (active) options.onState(state);
      }),
    );
  } catch (cause) {
    releaseResources(
      [
        () => {
          throw cause;
        },
        ...cleanups,
      ],
      'Controller view preparation failed.',
    );
    throw cause;
  }
  return {
    publish() {
      const playerNodes = [...staging.childNodes].filter(
        (node) => node !== heading && node !== chaptersMenu(),
      );
      options.controls.replaceChildren(...playerNodes);
      chapters.attach(options.heading);
      options.caption.textContent = caption.textContent;
      active = true;
      if (latest) options.onState(latest);
    },
    refreshHeading(title: string, enabled: boolean) {
      chapters.dispose();
      options.heading.textContent = title;
      options.heading.title = title;
      chapters = chapterNavigation(
        options.heading,
        controller.sheet.script.segments ?? [],
        (time) => controller.seek(time, { mode: 'story' }),
        enabled,
        options.headingLabel,
      );
      chapters.update(controller.presented?.chapter);
    },
    dispose() {
      active = false;
      releaseResources(cleanups, 'Controller view disposal failed.');
    },
  };
  function chaptersMenu() {
    return staging.querySelector('.ve-chapter-menu');
  }
}
