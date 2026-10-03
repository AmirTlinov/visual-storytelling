let ready: Promise<void> | undefined;
/** Request the drawing fonts before measuring an initially empty scene. */
export function loadFonts() {
  return (ready ??= (async () => {
    const loaded = await Promise.all(
      ['SketchPencil', 'SketchShantell'].map((name) => document.fonts.load(`400 24px ${name}`)),
    );
    if (loaded.some((faces) => !faces.length))
      throw new Error('Import @visual-storytelling/core/style.css before loading scene fonts');
    await document.fonts.ready;
  })());
}
