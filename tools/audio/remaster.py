"""Refresh only the mix of a still-current accepted performance; never invoke a model."""
import json
from contextlib import contextmanager
from pathlib import Path
import shutil
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


class PublicationRecoveryError(RuntimeError):
    """Keep the accepted recording available for manual recovery after filesystem failures."""
    def __init__(self, staging, publication_error, recovery_errors):
        self.staging = staging
        self.publication_error = publication_error
        self.recovery_errors = tuple(recovery_errors)
        details = "; ".join(f"{action}: {error}" for action, error in recovery_errors)
        super().__init__(f"Narration could not be fully restored. Recovery files remain at {staging}. {details}")


@contextmanager
def staging_directory(parent, prefix):
    """Remove temporary audio unless failed recovery still needs its accepted-file backups."""
    staging = Path(tempfile.mkdtemp(prefix=prefix, dir=parent))
    preserve = False
    try:
        yield staging
    except PublicationRecoveryError as error:
        preserve = error.staging == staging
        raise
    finally:
        if not preserve:
            shutil.rmtree(staging)


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
    except BaseException as error:
        recovery = []
        for name in installed:
            try:
                (output / name).unlink(missing_ok=True)
            except BaseException as failure:
                recovery.append((f"removing new {name}", failure))
        for name in moved:
            try:
                (previous / name).replace(output / name)
            except BaseException as failure:
                recovery.append((f"restoring {name}", failure))
        if recovery:
            raise PublicationRecoveryError(staging, error, recovery) from error
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
    with staging_directory(output.parent, ".sketch-remaster-") as staging:
        timeline["mix"] = mix(voice, spec.get("music"), staging)
        audio_hashes(staging, timeline)
        (staging / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        check_timeline(script_path, staging / "timeline.json", source_directory=source_directory)
        if any(file_digest(output / name) != value for name, value in before.items()):
            raise RuntimeError("Accepted narration changed during remastering; retry after edits finish")
        publish(staging, output, ("audio.wav", "voice.wav", "music.wav", "timeline.json"))
    return timeline
