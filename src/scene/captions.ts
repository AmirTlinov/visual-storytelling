import { captionTrack, type CaptionOptions, type CaptionTrack } from '../story/captions.js';
import type { Script } from '../story/cues.js';
import type { SceneFramePresentation } from '../scene.js';
export type SceneCaptions = true | (CaptionOptions & { placement?: 'overlay' | 'below' });

/** One caption element, track and placement; transport still owns its time. */
export function sceneCaptions(settings?: SceneCaptions) {
  const element = document.createElement('p');
  element.className = settings ? 've-captions' : 'caption sr-only';
  element.dataset.caption = '';
  element.setAttribute('role', 'status');
  const explicitOverlay = settings !== true && settings?.placement === 'overlay';
  return {
    element,
    track(script: Pick<Script, 'segments' | 'captionAliases'>): CaptionTrack {
      return captionTrack(
        {
          ...script,
          segments: settings
            ? script.segments
            : script.segments?.map(({ words: _words, ...chapter }) => chapter),
        },
        settings === true ? {} : settings,
      );
    },
    place({
      presentation,
      completeFrame,
      stage,
      paper,
      controls,
    }: {
      presentation: SceneFramePresentation;
      completeFrame: boolean;
      stage: HTMLElement;
      paper: HTMLElement;
      controls: HTMLElement;
    }) {
      const overlay =
        explicitOverlay ||
        (!completeFrame && !!settings && (settings === true || settings.placement !== 'below'));
      if (overlay) {
        stage.append(element);
        element.dataset.placement = 'overlay';
      } else {
        delete element.dataset.placement;
        if (!completeFrame || presentation === 'stage') controls.before(element);
        else paper.append(element);
      }
    },
  };
}
