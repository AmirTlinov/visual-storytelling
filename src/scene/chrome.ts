import type { sceneFrame } from '../scene-frame.js';
import type { SceneFramePresentation } from '../scene.js';
import type { conditionsPanel } from './conditions.js';
import { holdControlFocus } from './control-focus.js';
/** One placement owner keeps the same fields and focused drafts across frame scopes. */
export function sceneChrome({
  root,
  sheet,
  drawing,
  stage,
  header,
  heading,
  toolbar,
  fields,
  controls,
  composition,
  panel,
  showHistory,
  dense,
  signal,
  state,
}: {
  root: HTMLElement;
  sheet: HTMLElement;
  drawing: HTMLElement;
  stage: HTMLElement;
  header: HTMLElement;
  heading: HTMLElement;
  toolbar: HTMLElement;
  fields: HTMLElement;
  controls: HTMLElement;
  composition: ReturnType<typeof sceneFrame>;
  panel: ReturnType<typeof conditionsPanel>;
  showHistory: boolean;
  dense: boolean;
  signal: AbortSignal;
  state: () => { mode: 'story' | 'explore'; presentation: SceneFramePresentation | undefined };
}) {
  const visibleContent = (element: Element): boolean => {
    if (element.hasAttribute('hidden') || getComputedStyle(element).display === 'none')
      return false;
    return (
      element.matches('input,textarea,button') ||
      [...element.childNodes].some((child) =>
        child instanceof Element ? visibleContent(child) : Boolean(child.textContent?.trim()),
      )
    );
  };
  const conditions = panel.element,
    conditionsButton = panel.button,
    placeConditions = panel.place;
  function updateChrome(preserveFocus = false) {
    if (signal.aborted) return;
    const { mode, presentation: shownPresentation } = state();
    const compact = composition.element.getBoundingClientRect().width < 640;
    const denseConditions = dense;
    // Opening Conditions exposes the inputs; only editing them enters an experiment.
    fields.hidden = !fields.childElementCount || (mode === 'story' && !compact && !denseConditions);
    const toolbarVisible = [...toolbar.children].some(visibleContent);
    if (toolbar.hidden === toolbarVisible) toolbar.hidden = !toolbarVisible;
    const focused = document.activeElement,
      ownedFocus =
        focused instanceof HTMLElement &&
        (header.contains(focused) || toolbar.contains(focused) || fields.contains(focused)),
      hasUI = toolbarVisible || visibleContent(fields),
      popup = compact && hasUI,
      popupFields = (compact || denseConditions) && hasUI,
      hasConditions = popupFields || showHistory || panel.hasResources;
    sheet.dataset.compactChrome = String(compact);
    conditionsButton.hidden = !hasConditions;
    header.hidden = heading.hidden && !hasConditions && !toolbarVisible;
    const headerParent = shownPresentation === 'stage' ? root : sheet,
      toolbarParent = popup ? conditions : header,
      fieldsParent = popupFields ? conditions : shownPresentation === 'stage' ? root : drawing;
    const moved =
      header.parentElement !== headerParent ||
      toolbar.parentElement !== toolbarParent ||
      fields.parentElement !== fieldsParent;
    const leavingConditions =
      moved &&
      ((toolbar.parentElement === conditions && toolbarParent !== conditions) ||
        (fields.parentElement === conditions && fieldsParent !== conditions));
    const keepEdit = moved && preserveFocus && ownedFocus,
      restoreFocus = keepEdit && document.hasFocus();
    const draft = keepEdit ? holdControlFocus([toolbar, fields]) : undefined;
    try {
      if ((!hasConditions || leavingConditions) && conditions.matches(':popover-open'))
        conditions.hidePopover();
      if (header.parentElement !== headerParent) {
        if (headerParent === root) root.insertBefore(header, composition.element);
        else sheet.prepend(header);
      }
      if (moved) {
        const historyBar =
          conditions.querySelector(':scope > .ve-experiment-history') ?? panel.resources;
        if (toolbarParent === conditions) conditions.insertBefore(toolbar, historyBar);
        else if (toolbar.parentElement !== header) conditionsButton.before(toolbar);
        if (fieldsParent === conditions) conditions.insertBefore(fields, historyBar);
        else if (fieldsParent === root) controls.before(fields);
        else if (fields.parentElement !== drawing) stage.before(fields);
      }
      // Reparenting a native field emits blur/focus. Its draft and history gesture
      // still belong to the same edit; only an actual departure commits them.
      if (restoreFocus) {
        if (conditions.contains(focused) && !conditions.matches(':popover-open'))
          conditions.showPopover();
        draft?.restore();
      }
    } finally {
      draft?.release();
    }
    placeConditions();
  }
  const resized = () => updateChrome(true);
  root.addEventListener('scene-frame-resize', resized, { signal });
  // Actions/chapter navigation are public extension points of this shell.
  const chromeObserver = new MutationObserver(() => updateChrome());
  chromeObserver.observe(toolbar, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  const dispose = () => {
    root.removeEventListener('scene-frame-resize', resized);
    chromeObserver.disconnect();
    if (conditions.matches(':popover-open')) conditions.hidePopover();
  };
  return { update: updateChrome, dispose };
}
