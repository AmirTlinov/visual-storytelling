/** Native input and agent commands obey the same mounted scene suspension. */
export function assertSceneInteraction(root: Element) {
  if (root.closest('[inert]'))
    throw Object.assign(
      new Error('Scene interaction is suspended while its drawing is prepared or restored.'),
      {
        code: 'scene_interaction_suspended',
      },
    );
}
