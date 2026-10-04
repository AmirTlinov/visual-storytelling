"""Prepare a newly copied scene for authoring without narration or audio resources."""
import json
from pathlib import Path
import sys

from credits import authored_credits


def silence_copy(directory):
    story_path = directory / "story.json"
    if story_path.exists():
        story = json.loads(story_path.read_text())
        story.setdefault("narration", {})["enabled"] = False
        story_path.write_text(json.dumps(story, ensure_ascii=False, indent=2) + "\n")
    timeline_path = directory / "timeline.json"
    timeline = json.loads(timeline_path.read_text()) if timeline_path.exists() else {}
    credits_path = directory / "CREDITS.txt"
    if credits_path.exists():
        authored = authored_credits(credits_path.read_text(), timeline.get("mix", {}).get("music"))
        if authored:
            credits_path.write_text(authored + "\n")
        else:
            credits_path.unlink()
    if timeline:
        # Preserve authored story time and cues. No synthesis receipt refers to missing audio.
        script = {key: timeline[key] for key in ("version", "duration", "segments", "cues", "captionAliases") if key in timeline}
        for segment in script.get("segments", []):
            for key in ("audio_start", "audio_end", "seed", "delivery"):
                segment.pop(key, None)
        timeline_path.write_text(json.dumps(script, ensure_ascii=False, indent=2) + "\n")
    for name in ("narration.json", "narration.txt", "voice-preview.html", "audio.wav", "voice.wav", "music.wav"):
        (directory / name).unlink(missing_ok=True)


if __name__ == "__main__":
    silence_copy(Path(sys.argv[1]))
