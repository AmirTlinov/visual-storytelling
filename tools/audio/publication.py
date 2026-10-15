"""Thin bridge to the shared durable recording publication owner."""
import json
import os
from pathlib import Path
import shutil
import subprocess


def command(action, output, staging=None, names=None):
    root = Path(__file__).resolve().parents[2]
    bundled = root / "runtime" / "node"
    node = os.environ.get("VISUAL_STORY_NODE") or (str(bundled) if bundled.is_file() else shutil.which("node"))
    if not node:
        raise RuntimeError("Narration publication needs the plugin's bundled Node runtime")
    args = [node, str(root / "tools" / "voice" / "publication.mjs"), action, str(output)]
    if staging is not None:
        args += [str(staging), json.dumps(list(names))]
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Narration publication failed")


def publish(staging, output, names):
    command("publish", output, staging, names)


def recover(output):
    command("recover", output)


def assert_published(output):
    command("check", output)
