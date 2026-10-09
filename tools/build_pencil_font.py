#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools[woff]==4.61.1", "skia-pathops==0.9.1"]
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
reference_advances = {chr(code): source["hmtx"][name][0] for code, name in cmap.items()}
spec = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    """const {build}=await import('esbuild');
const source=await build({stdin:{contents:`export {glyphs} from ${JSON.stringify(process.argv[1])};
export {handwritingProfiles,handwritingMetrics,handwritingTransform} from ${JSON.stringify(process.argv[2])};`,
resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const {glyphs,handwritingProfiles,handwritingMetrics,handwritingTransform}=await import(
  'data:text/javascript;base64,'+Buffer.from(source.outputFiles[0].text).toString('base64'));
const reference=JSON.parse(process.argv[3]);
const advances=Object.fromEntries([' ',...Object.keys(glyphs)].map(c=>[c,/^[0-9]$/.test(c)?680:reference[c]??620]));
const transforms=Object.fromEntries(Object.entries(handwritingProfiles).map(([name,profile])=>[
  name,Object.fromEntries(Object.keys(glyphs).map(c=>[c,handwritingTransform(c,advances[c],handwritingMetrics.em,profile)]))
]));
process.stdout.write(JSON.stringify({glyphs,profiles:handwritingProfiles,metrics:handwritingMetrics,advances,transforms}));""",
    str(ASSETS.parent / "ink" / "glyphs.ts"),
    str(ASSETS.parent / "ink" / "handwriting.ts"),
    json.dumps(reference_advances)], text=True, cwd=ASSETS.parent.parent))
strokes = spec["glyphs"]
geometry = spec["metrics"]

names = {ord(char): f"u{ord(char):04X}" for char in strokes}
names[32] = "space"
for profile, hand in spec["profiles"].items():
    glyphs = {}
    metrics = {}
    for codepoint, name in {0: ".notdef", **names}.items():
        advance = spec["advances"].get(chr(codepoint), 620)
        pen = TTGlyphPen(None)
        if chr(codepoint) in strokes:
            shape = pathops.Path()
            for stroke in strokes[chr(codepoint)]:
                parse_path(stroke, shape.getPen())
            shape.stroke(hand["stroke"], pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
            shape.convertConicsToQuads(.01)
            shape.simplify()
            # Fonts use an upward Y axis; the shared matrix describes SVG ink.
            a, b, c, d, x, y = spec["transforms"][profile][chr(codepoint)]
            shape.draw(TransformPen(Cu2QuPen(pen, 1), (a, -b, c, -d, x, -y)))
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
    font.setupNameTable({"familyName": hand["family"], "styleName": "Regular", "uniqueFontIdentifier": f"{hand['family']}-Regular-2", "fullName": f"{hand['family']} Regular", "psName": f"{hand['family']}-Regular", "version": "Version 2.0"})
    font.setupPost(italicAngle=-hand["slant"])
    font.font["head"].created = source["head"].created
    font.font["head"].modified = source["head"].modified
    font.font.recalcTimestamp = False
    font.font.flavor = "woff2"
    target = ASSETS / ("pencil.woff2" if profile == "body" else f"pencil-{profile}.woff2")
    font.save(target)
    print(f"{target}: {len(names)} glyphs, {target.stat().st_size} bytes")
