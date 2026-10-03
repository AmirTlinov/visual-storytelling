"""Own the single timeline: clips, pauses, word cues and final audio."""
import json
from pathlib import Path
import tempfile
import time

import numpy as np

from alignment import Aligner
from mixing import mix
from resources import ALIGN_REPO, ALIGN_REVISION, SPEECH_CREDIT
from script import read_script, timed_cues
from speech import SAMPLE_RATE, Speaker


def build_audio(script_path, output, device):
    started = time.perf_counter()
    spec = read_script(script_path)
    speaker = Speaker(spec["voice"])
    aligner = Aligner(device)
    segments, cues, chunks, stats = [], {}, [], []
    cursor = round(spec["intro"] * SAMPLE_RATE)
    chunks.append(np.zeros(cursor, dtype=np.float32))
    warnings = []
    for segment in spec["segments"]:
        print(f'Voice + word timing: {segment["id"]}', flush=True)
        audio, key, synthesis = speaker.synthesize(segment)
        aligned, timing = aligner.align(audio, segment["spoken"], key)
        offset = cursor / SAMPLE_RATE
        words = [{**w, "start": round(w["start"] + offset, 5), "end": round(w["end"] + offset, 5)} for w in aligned]
        record = {
            "id": segment["id"], "text": segment["spoken"], "start": words[0]["start"], "end": words[-1]["end"],
            "audio_start": offset, "audio_end": (cursor + len(audio)) / SAMPLE_RATE, "words": words,
        }
        segments.append(record)
        cues.update(timed_cues(segment, words))
        for w in words:
            if w["score"] < .3:
                warnings.append(f'{segment["id"]}: check word {w["text"]!r} (acoustic score {w["score"]})')
        chunks.append(audio)
        pause = round(segment["pause_after"] * SAMPLE_RATE)
        chunks.append(np.zeros(pause, dtype=np.float32))
        cursor += len(audio) + pause
        stats.append({"id": segment["id"], "synthesis": synthesis, "alignment": timing})
    chunks.append(np.zeros(round(spec["outro"] * SAMPLE_RATE), dtype=np.float32))
    voice = np.concatenate(chunks)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Assemble to a temporary sibling. Failed builds never replace a working mix.
    with tempfile.TemporaryDirectory(prefix=".sketch-audio-", dir=output.parent) as temporary:
        staging = Path(temporary)
        print("Mixing the shared timeline", flush=True)
        mix_info = mix(voice, spec.get("music"), staging)
        credits = staging / "CREDITS.txt"
        music_credit = credits.read_text() if credits.exists() else ""
        credits.write_text(SPEECH_CREDIT + ("\n" + music_credit if music_credit else ""))
        timeline = {
            "version": 1, "sample_rate": SAMPLE_RATE, "duration": len(voice) / SAMPLE_RATE,
            "audio": "audio.wav", "voice": "voice.wav", "music": "music.wav" if spec.get("music") else None,
            "voice_settings": spec["voice"], "synthesis": speaker.identity,
            "segments": segments, "cues": cues,
            "alignment": {"method": "ctc-forced-alignment", "model": ALIGN_REPO, "revision": ALIGN_REVISION,
                          "device": aligner.device, "nominal_frame_seconds": .02},
            "mix": mix_info, "warnings": warnings,
            "build": {"seconds": round(time.perf_counter() - started, 3), "segments": stats},
        }
        (staging / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2) + "\n")
        (staging / "narration.txt").write_text("\n\n".join(s["spoken"] for s in spec["segments"]) + "\n")
        output.mkdir(parents=True, exist_ok=True)
        # Own only these output names; keep user-authored JS and illustrations.
        for name in ("audio.wav", "voice.wav", "music.wav", "CREDITS.txt", "timeline.json", "narration.txt"):
            if (staging / name).exists():
                (staging / name).replace(output / name)
            elif name in {"music.wav", "CREDITS.txt"}:
                (output / name).unlink(missing_ok=True)
    print(json.dumps({"output": str(output), "duration": timeline["duration"], "build_seconds": timeline["build"]["seconds"],
                      "cached_segments": sum(s["synthesis"]["cached"] and s["alignment"]["cached"] for s in stats),
                      "warnings": warnings}, ensure_ascii=False, indent=2), flush=True)
    return timeline
