#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools[woff]", "skia-pathops"]
# ///
"""Build static lettering from the same pen strokes used by narrated writing.

Run after editing src/ink/glyphs.ts. Shantell supplies spacing and fallback;
the generated outlines are the skill's own strokes, without browser-side copies.
"""
import json
from pathlib import Path
import subprocess

import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib import TTFont

ASSETS = Path(__file__).resolve().parent.parent / "src" / "assets"
source = TTFont(ASSETS / "shantell.woff2")
cmap = source.getBestCmap()
strokes = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e", "const {glyphs}=await import(process.argv[1]);process.stdout.write(JSON.stringify(glyphs))",
    (ASSETS.parent / "ink" / "glyphs.ts").as_uri()], text=True))

names = {ord(char): f"u{ord(char):04X}" for char in strokes}
names[32] = "space"
glyphs = {}
metrics = {}
for codepoint, name in {0: ".notdef", **names}.items():
    advance = source["hmtx"][cmap[codepoint]][0] if codepoint in cmap else 620
    pen = TTGlyphPen(None)
    if chr(codepoint) in strokes:
        shape = pathops.Path()
        for stroke in strokes[chr(codepoint)]:
            parse_path(stroke, shape.getPen())
        shape.stroke(.65, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
        shape.convertConicsToQuads(.01)
        shape.simplify()
        # Matches SketchMotion.prepareText: 6.7 units across, baseline at 10.
        shape.draw(TransformPen(Cu2QuPen(pen, 1), (advance / 6.7, 0, 0, -82, advance * .055, 820)))
    glyph = pen.glyph()
    if glyph.numberOfContours:
        glyph.recalcBounds(None)
    glyphs[name] = glyph
    metrics[name] = (advance, getattr(glyph, "xMin", 0))

font = FontBuilder(1000, isTTF=True)
font.setupGlyphOrder(list(glyphs))
font.setupCharacterMap(names)
font.setupGlyf(glyphs)
font.setupHorizontalMetrics(metrics)
font.setupHorizontalHeader(ascent=1100, descent=-400)
font.setupOS2(sTypoAscender=1100, sTypoDescender=-400, usWinAscent=1100, usWinDescent=400)
font.setupNameTable({"familyName": "Sketch Pencil", "styleName": "Regular", "uniqueFontIdentifier": "SketchPencil-Regular-1", "fullName": "Sketch Pencil Regular", "psName": "SketchPencil-Regular", "version": "Version 1.0"})
font.setupPost()
font.font.flavor = "woff2"
target = ASSETS / "pencil.woff2"
font.save(target)
print(f"{target}: {len(names)} glyphs, {target.stat().st_size} bytes")
