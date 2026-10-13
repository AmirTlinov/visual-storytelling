"""Refresh only the mix of a still-current accepted performance; never invoke a model."""
import json
from pathlib import Path
import tempfile

import soundfile as sf

from mastering import PROFILE_SHA256
from mixing import mix
from resources import digest, file_digest
from script import check_timeline, read_script
from speech import SAMPLE_RATE


def audio_hashes(directory, timeline):
    timeline["audio_sha256"] = file_digest(directory / "audio.wav")
    timeline["stem_sha256"] = {name: file_digest(directory / name)
                               for name in ("voice.wav", "music.wav") if (directory / name).is_file()}


def publish(staging, output, names):
    """Publish the recording/receipt together, restoring accepted files on any failure."""
    previous = staging / ".previous"
    previous.mkdir()
    moved, installed = [], []
    try:
        for name in names:
            target = output / name
            if target.exists():
                if not target.is_file():
                    raise ValueError(f"Narration output must be a regular file: {name}")
                target.replace(previous / name)
                moved.append(name)
        for name in names:
            if (staging / name).exists():
                (staging / name).replace(output / name)
                installed.append(name)
    except BaseException:
        for name in installed:
            (output / name).unlink(missing_ok=True)
        for name in moved:
            (previous / name).replace(output / name)
        raise


def reuse_audio(script_path, output, *, source_directory=None):
    """None means changed speech. A stale master is repaired or fails without synthesis."""
    receipt = output / "timeline.json"
    if not receipt.exists():
        return None
    timeline = json.loads(receipt.read_text())
    if timeline.get("source_sha256") != digest(json.loads(script_path.read_text())):
        return None
    try:
        check_timeline(script_path, receipt, source_directory=source_directory, require_mastering=False)
    except ValueError as error:
        if str(error).startswith(("Voice reference changed", "Music changed")):
            return None
        raise
    if (timeline.get("mix", {}).get("mastering", {}).get("profile_sha256") == PROFILE_SHA256
            and timeline.get("audio_sha256")):
        return timeline
    spec = read_script(script_path, source_directory=source_directory)
    voice_file = output / "voice.wav"
    if not voice_file.is_file():
        raise ValueError("Accepted voice.wav is missing; cannot remaster without generating new speech")
    # Read the accepted stem before replacing anything. Its performance and pauses remain untouched.
    voice, rate = sf.read(voice_file, dtype="float32")
    if rate != SAMPLE_RATE or len(voice) != round(timeline["duration"] * rate):
        raise ValueError("Accepted voice stem does not match its timeline")
    before = {name: file_digest(output / name) for name in ("timeline.json", "audio.wav", "voice.wav")}
    with tempfile.TemporaryDirectory(prefix=".sketch-remaster-", dir=output.parent) as directory:
        staging = Path(directory)
        timeline["mix"] = mix(voice, spec.get("music"), staging)
        audio_hashes(staging, timeline)
        (staging / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        check_timeline(script_path, staging / "timeline.json", source_directory=source_directory)
        if any(file_digest(output / name) != value for name, value in before.items()):
            raise RuntimeError("Accepted narration changed during remastering; retry after edits finish")
        publish(staging, output, ("audio.wav", "voice.wav", "music.wav", "timeline.json"))
    return timeline
