#!/usr/bin/env python3
"""Embed the skill's shared ink and local font in an editable standalone SVG."""
import argparse
import base64
from pathlib import Path
import re

ASSETS = Path(__file__).resolve().parent.parent / "dist" / "assets"


def themed(svg):
    ink = (ASSETS.parent / "styles" / "ink.css").read_text()
    handwriting = (ASSETS.parent / "styles" / "handwriting.css").read_text()
    ink = ink.replace("@import './handwriting.css';", handwriting)
    for filename in ("pencil.woff2", "pencil-heading.woff2", "pencil-note.woff2", "shantell.woff2"):
        font = base64.b64encode((ASSETS / filename).read_bytes()).decode()
        ink = ink.replace(f"url('../assets/{filename}')", f"url('data:font/woff2;base64,{font}')")
    for filename in ('scene-objects.css', 'label-overflow.css'):
        ink += '\n' + (ASSETS.parent / 'styles' / filename).read_text()
    if '<foreignObject' in svg:
        ink += '\n' + (ASSETS.parent / 'styles' / 'range.css').read_text()
    svg = re.sub(r'<style id="ve-shared-ink">.*?</style>\s*', '', svg, flags=re.S)
    opening = re.search(r'<svg\b[^>]*>', svg)
    if not opening:
        raise ValueError("Expected an SVG document")
    tag = opening.group()
    if 'class="ve-scene"' not in tag:
        tag = tag[:-1] + ' class="ve-scene">'
    return svg[:opening.start()] + tag + '\n<style id="ve-shared-ink">' + ink + '</style>\n' + svg[opening.end():]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('svg', type=Path)
    args = parser.parse_args()
    args.svg.write_text(themed(args.svg.read_text()))
