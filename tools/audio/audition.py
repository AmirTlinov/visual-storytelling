"""Compare whole narration takes through the same synthesis/alignment pipeline."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile

from listening import write_listening_page
from resources import digest
from script import read_script, seed


def audition(script_path, segment_id, output, seeds=None, device="auto"):
    source = json.loads(script_path.read_text())
    normalized = read_script(script_path)
    selected = next((s for s in normalized["segments"] if s["id"] == segment_id), None)
    if selected is None:
        raise ValueError(f"Unknown segment {segment_id!r}; choose from " +
                         ", ".join(s["id"] for s in normalized["segments"]))
    seeds = seeds if seeds is not None else [(selected["seed"] + i) % 2**32 for i in range(3)]
    seeds = list(dict.fromkeys(seed(value, "audition seed") for value in seeds))
    if not seeds:
        raise ValueError("Provide at least one audition seed")
    if script_path.is_relative_to(output):
        raise ValueError("Use a separate audition output directory")
    if Path(normalized["voice"]["reference_audio"]).is_relative_to(output):
        raise ValueError("Keep the voice reference outside the audition output directory")
    if output.exists() and any(output.iterdir()) and not (output / "audition.json").is_file():
        raise ValueError("Use an empty directory or an existing audition output")
    output.parent.mkdir(parents=True, exist_ok=True)

    from alignment import Aligner
    from assembly import build_audio
    from speech import Speaker

    # Snapshot just the chosen thought, keeping its text and every visual cue.
    # Absolute reference paths retain the source script's path semantics.
    segment = deepcopy(next(s for s in source["segments"] if s["id"] == segment_id))
    spec = {"version": 3, "intro": .35, "outro": .35, "music": None,
            "voice": normalized["voice"], "segments": [segment]}
    speaker, aligner = Speaker(normalized["voice"]), Aligner(device)
    # Publish the complete comparison together: a failed retake leaves the old
    # page, scripts, audio and cue receipts mutually consistent.
    with tempfile.TemporaryDirectory(prefix=".sketch-audition-", dir=output.parent) as temporary:
        staging = Path(temporary) / "ready"
        staging.mkdir()
        takes = []
        for value in seeds:
            print(f"Audition: seed {value}", flush=True)
            segment["seed"] = value
            directory = staging / f"seed-{value}"
            directory.mkdir()
            script = directory / "narration.json"
            script.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n")
            timeline = build_audio(script, directory, device, speaker=speaker, aligner=aligner, report=False)
            takes.append({"seed": value, "audio": f"seed-{value}/audio.wav",
                          "script": f"seed-{value}/narration.json", "duration": timeline["duration"],
                          "warnings": timeline["warnings"]})
        receipt = {"source": str(script_path), "source_sha256": digest(source),
                   "segment": segment_id, "text": selected["spoken"], "takes": takes}
        (staging / "audition.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
        write_listening_page(staging / "index.html", title=segment.get("title", segment_id),
                             transcript=selected["spoken"],
                             takes=[{**take, "label": f'Дубль {take["seed"]}'} for take in takes],
                             note="Каждый дубль — одна непрерывная реплика. Выбранный seed укажите в этом сегменте исходного сценария и пересоберите озвучку.")
        if digest(json.loads(script_path.read_text())) != receipt["source_sha256"]:
            raise RuntimeError("Narration changed during the audition; rerun with the current script")
        previous = Path(temporary) / "previous"
        if output.exists():
            output.rename(previous)
        try:
            staging.rename(output)
        except BaseException:
            if previous.exists():
                previous.rename(output)
            raise
    print(json.dumps({"audition": str(output / "index.html"), "segment": segment_id,
                      "seeds": seeds}, ensure_ascii=False), flush=True)
    return receipt
