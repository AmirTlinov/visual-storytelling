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
import math
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
spec = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    "const {glyphs}=await import(process.argv[1]);const {handwritingProfiles,handwritingMetrics}=await import(process.argv[2]);process.stdout.write(JSON.stringify({glyphs,profiles:handwritingProfiles,metrics:handwritingMetrics}))",
    (ASSETS.parent / "ink" / "glyphs.ts").as_uri(),
    (ASSETS.parent / "ink" / "handwriting.ts").as_uri()], text=True))
strokes = spec["glyphs"]
geometry = spec["metrics"]

names = {ord(char): f"u{ord(char):04X}" for char in strokes}
names[32] = "space"
for profile, hand in spec["profiles"].items():
    glyphs = {}
    metrics = {}
    vertical = geometry["capHeight"] / geometry["baseline"]
    slant = math.tan(math.radians(hand["slant"]))
    for codepoint, name in {0: ".notdef", **names}.items():
        advance = source["hmtx"][cmap[codepoint]][0] if codepoint in cmap else 620
        pen = TTGlyphPen(None)
        if chr(codepoint) in strokes:
            shape = pathops.Path()
            for stroke in strokes[chr(codepoint)]:
                parse_path(stroke, shape.getPen())
            shape.stroke(hand["stroke"], pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
            shape.convertConicsToQuads(.01)
            shape.simplify()
            # The runtime uses the same baseline shear after scaling its centerlines.
            shape.draw(TransformPen(Cu2QuPen(pen, 1), (
                advance / geometry["glyphWidth"], 0, -vertical * slant, -vertical,
                advance * geometry["inset"] + geometry["capHeight"] * slant,
                geometry["capHeight"])))
        glyph = pen.glyph()
        if glyph.numberOfContours:
            glyph.recalcBounds(None)
        glyphs[name] = glyph
        metrics[name] = (advance, getattr(glyph, "xMin", 0))

    font = FontBuilder(geometry["em"], isTTF=True)
    font.setupGlyphOrder(list(glyphs))
    font.setupCharacterMap(names)
    font.setupGlyf(glyphs)
    font.setupHorizontalMetrics(metrics)
    font.setupHorizontalHeader(ascent=1100, descent=-400)
    font.setupOS2(sTypoAscender=1100, sTypoDescender=-400, usWinAscent=1100, usWinDescent=400)
    font.setupNameTable({"familyName": hand["family"], "styleName": "Regular", "uniqueFontIdentifier": f"{hand['family']}-Regular-1", "fullName": f"{hand['family']} Regular", "psName": f"{hand['family']}-Regular", "version": "Version 1.0"})
    font.setupPost(italicAngle=-hand["slant"])
    font.font.flavor = "woff2"
    target = ASSETS / ("pencil.woff2" if profile == "body" else f"pencil-{profile}.woff2")
    font.save(target)
    print(f"{target}: {len(names)} glyphs, {target.stat().st_size} bytes")
