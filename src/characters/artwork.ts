import type { CharacterStageOptions, PropArt } from './types.js';
import type { CharacterSurface } from './surfaces.js';

/** Trusted authored artwork keeps scoped SVG definitions in flat and physical drawings. */
export function mountArtwork(parent: SVGElement, art: PropArt, scope: string) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  node.innerHTML = art.svg.replaceAll('$id', scope);
  parent.append(node);
  return node;
}

/** Physical SVGs use the existing live surface, including depth, capture and disposal. */
export function artworkSurfaces(options: CharacterStageOptions) {
  const definitions: Record<string, CharacterSurface> = { ...options.surfaces };
  const carried = new Set([
    ...Object.values(options.cast).map((actor) => actor.holding),
    ...options.beats.flatMap((beat) =>
      (beat.perform ?? []).flatMap((action) => (action.action === 'take' ? [action.object] : [])),
    ),
  ]);
  for (const [id, item] of Object.entries(options.set.staging?.objects ?? {})) {
    const art = item.art;
    if (!art?.paint || (options.background === false && !carried.has(id))) continue;
    definitions[id] = {
      title: art.title ?? id,
      size: { width: art.width, height: art.height },
      create(view) {
        const node = mountArtwork(view.layer, art, view.element.id);
        node.setAttribute('transform', `translate(${art.width / 2} ${art.height})`);
        let values: Readonly<Record<string, number>> = {};
        return {
          render(frame) {
            values = Object.fromEntries(
              Object.entries(frame.values).filter(
                (entry): entry is [string, number] => typeof entry[1] === 'number',
              ),
            );
            art.paint!(node, values);
          },
          snapshot: () => ({ values }),
        };
      },
    };
  }
  return definitions;
}
