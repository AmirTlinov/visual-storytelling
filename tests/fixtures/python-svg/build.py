# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Minimal Python/uv generator consumer: embed the installed shared ink."""
import importlib.util
import os
from pathlib import Path

tools = Path(os.environ["VISUAL_STORY_TOOLS"])
spec = importlib.util.spec_from_file_location("svg_style", tools / "svg_style.py")
style = importlib.util.module_from_spec(spec)
spec.loader.exec_module(style)
svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<title>Python generator fixture</title>
<rect x="260" y="200" width="760" height="320" fill="none" stroke="var(--ve-ink)" stroke-width="3"/>
<text x="400" y="380" font-size="56" fill="var(--ve-ink)">Сумма: 2 + 3 = 5</text>
</svg>'''
(Path(os.environ["VISUAL_STORY_OUTPUT"]) / "subject.svg").write_text(style.themed(svg))
