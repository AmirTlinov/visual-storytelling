"""Own the single timeline: clips, pauses, word cues and final audio."""
import json
from pathlib import Path
import tempfile
import time

import numpy as np

from alignment import Aligner
from credits import audio_credits
from listening import write_listening_page
from mixing import mix
from resources import ALIGN_REPO, ALIGN_REVISION, digest
from script import read_script, timed_cues, speech_passages
from speech import SAMPLE_RATE, Speaker
from quality import complete_take


def prepared_take(speaker, aligner, segment, passages):
    if len(passages) == 1:
        return complete_take(speaker, aligner, segment)
    chunks, words, records, failures = [], [], [], []
    cursor = 0
    for index, passage in enumerate(passages):
        take, audio, aligned, synthesis, timing, retries = complete_take(speaker, aligner, passage)
        if words:
            # Existing head/tail silence already contributes to the sentence pause.
            silence = cursor / SAMPLE_RATE - words[-1]["end"] + aligned[0]["start"]
            pause = max(0, round((.2 - silence) * SAMPLE_RATE))
            if pause:
                chunks.append(np.zeros(pause, dtype=np.float32))
                cursor += pause
        offset = cursor / SAMPLE_RATE
        records.append({"seed": take["seed"], "word_start": len(words),
                        "word_end": len(words) + len(aligned),
                        "synthesis": synthesis, "alignment": timing})
        words.extend({**word, "start": word["start"] + offset, "end": word["end"] + offset}
                     for word in aligned)
        chunks.append(audio)
        cursor += len(audio)
        failures.extend({**retry, "passage": index} for retry in retries)
    def summary(kind):
        return {"cached": all(record[kind]["cached"] for record in records),
                "seconds": round(sum(record[kind].get("seconds", 0) for record in records), 4)}
    return ({**segment, "passages": records}, np.concatenate(chunks), words,
            summary("synthesis"), summary("alignment"), failures)


def build_audio(script_path, output, device, *, speaker=None, aligner=None, report=True):
    started = time.perf_counter()
    source_digest = digest(json.loads(script_path.read_text()))
    spec = read_script(script_path)
    passages = [speech_passages(segment) for segment in spec["segments"]]
    if speaker is not None and speaker.voice != spec["voice"]:
        raise ValueError("A shared speaker must use the same voice settings")
    speaker = speaker or Speaker(spec["voice"])
    aligner = aligner or Aligner(device)
    segments, cues, chunks, stats = [], {}, [], []
    cursor = round(spec["intro"] * SAMPLE_RATE)
    chunks.append(np.zeros(cursor, dtype=np.float32))
    warnings = []
    for segment, prepared in zip(spec["segments"], passages, strict=True):
        print(f'Voice + word timing: {segment["id"]}', flush=True)
        take, audio, aligned, synthesis, timing, retries = prepared_take(speaker, aligner, segment, prepared)
        offset = cursor / SAMPLE_RATE
        words = [{**w, "start": round(w["start"] + offset, 5), "end": round(w["end"] + offset, 5)} for w in aligned]
        record = {
            "id": segment["id"], "text": segment["spoken"], "start": words[0]["start"], "end": words[-1]["end"],
            "audio_start": offset, "audio_end": (cursor + len(audio)) / SAMPLE_RATE, "words": words,
            "seed": take["seed"], "delivery": segment["delivery"],
        }
        if "title" in segment:
            record["title"] = segment["title"]
        if "passages" in take:
            record["passages"] = [{key: part[key] for key in ("seed", "word_start", "word_end")}
                                  for part in take["passages"]]
        segments.append(record)
        cues.update(timed_cues(segment, words))
        for w in words:
            if w["score"] < .3:
                warnings.append(f'{segment["id"]}: check word {w["text"]!r} (acoustic score {w["score"]})')
        chunks.append(audio)
        pause = round(segment["pause_after"] * SAMPLE_RATE)
        chunks.append(np.zeros(pause, dtype=np.float32))
        cursor += len(audio) + pause
        stats.append({"id": segment["id"], "synthesis": synthesis, "alignment": timing, "retries": retries,
                      **({"passages": take["passages"]} if "passages" in take else {})})
    chunks.append(np.zeros(round(spec["outro"] * SAMPLE_RATE), dtype=np.float32))
    voice = np.concatenate(chunks)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Assemble to a temporary sibling. Failed builds never replace a working mix.
    with tempfile.TemporaryDirectory(prefix=".sketch-audio-", dir=output.parent) as temporary:
        staging = Path(temporary)
        print("Mixing the shared timeline", flush=True)
        mix_info = mix(voice, spec.get("music"), staging)
        credits = output / "CREDITS.txt"
        previous = output / "timeline.json"
        previous_timeline = json.loads(previous.read_text()) if previous.exists() else None
        previous_mix = previous_timeline.get("mix", {}) if previous_timeline else {}
        (staging / "CREDITS.txt").write_text(audio_credits(
            credits.read_text() if credits.exists() else "", mix_info["music"], previous_mix.get("music"),
        ))
        build = {"seconds": round(time.perf_counter() - started, 3), "segments": stats}
        timeline = {
            "version": 1, "sample_rate": SAMPLE_RATE, "duration": len(voice) / SAMPLE_RATE,
            "source_sha256": source_digest,
            "audio": "audio.wav", "voice": "voice.wav", "music": "music.wav" if spec.get("music") else None,
            "voice_settings": spec["voice"], "synthesis": speaker.identity,
            "segments": segments, "cues": cues,
            "alignment": {"method": "ctc-forced-alignment", "model": ALIGN_REPO, "revision": ALIGN_REVISION,
                          "device": aligner.device, "nominal_frame_seconds": .02},
            "mix": mix_info, "warnings": warnings,
            "build": build,
        }
        if "captionAliases" in spec:
            timeline["captionAliases"] = spec["captionAliases"]
        # Rechecking cached speech must not change the authored package identity.
        # Keep the original receipt when only this run's timings/cache hits differ;
        # current build statistics are still reported below.
        if previous_timeline and ({k: v for k, v in previous_timeline.items() if k != "build"} ==
                                  {k: v for k, v in timeline.items() if k != "build"}):
            timeline = previous_timeline
            (staging / "timeline.json").write_bytes(previous.read_bytes())
        else:
            (staging / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2) + "\n")
        (staging / "narration.txt").write_text("\n\n".join(s["spoken"] for s in spec["segments"]) + "\n")
        write_listening_page(staging / "voice-preview.html", title="Озвучка рассказа",
                             transcript="\n\n".join(s["spoken"] for s in spec["segments"]),
                             takes=[{"label": "Цельный рассказ", "audio": "audio.wav",
                                     "duration": timeline["duration"], "warnings": warnings}],
                             note="Прослушайте начало, вопросы, выводы и переходы между мыслями.")
        if digest(json.loads(script_path.read_text())) != source_digest:
            raise RuntimeError("Narration changed during the build; rerun with the current script")
        output.mkdir(parents=True, exist_ok=True)
        # Own only these output names; keep user-authored JS and illustrations.
        for name in ("audio.wav", "voice.wav", "music.wav", "CREDITS.txt", "timeline.json", "narration.txt", "voice-preview.html"):
            if (staging / name).exists():
                (staging / name).replace(output / name)
            elif name == "music.wav":
                (output / name).unlink(missing_ok=True)
    if report:
        print(json.dumps({"output": str(output), "preview": str(output / "voice-preview.html"),
                          "duration": timeline["duration"], "build_seconds": build["seconds"],
                          "cached_segments": sum(s["synthesis"]["cached"] and s["alignment"]["cached"] for s in stats),
                          "warnings": warnings}, ensure_ascii=False, indent=2), flush=True)
    return timeline
