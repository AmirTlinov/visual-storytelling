"""Rebind accepted whole takes to explicit document units without synthesis or audio edits."""
import json
from pathlib import Path

from resources import atomic_destination, digest
from script import read_script, check_timeline, timed_cues, normalized


def bind_recording(script_path, timeline_path, *, source_directory=None):
    timeline_path = Path(timeline_path)
    source = json.loads(Path(script_path).read_text())
    spec = read_script(Path(script_path), source_directory=source_directory)
    timeline = json.loads(timeline_path.read_text())
    records = timeline.get("segments", [])
    if [unit.get("id") for unit in records] != [unit["id"] for unit in spec["segments"]]:
        raise ValueError("Accepted whole-take IDs do not match the explicit document units")
    cues = {}
    for unit, record in zip(spec["segments"], records, strict=True):
        if (record.get("text") != unit["spoken"] or record.get("source_seed",record.get("seed")) != unit["seed"] or
                record.get("delivery") != unit["delivery"] or
                record.get('source_text',record['text']) != unit['text'] or
                normalized(" ".join(word["text"] for word in record.get("words", []))) != normalized(unit["spoken"])):
            raise ValueError(f'{unit["id"]}: migration would change an accepted performance')
        if record.get("audio_start") is None or record.get("audio_end") is None:
            raise ValueError(f'{unit["id"]}: the accepted recording needs complete take boundaries')
        record["conditions"] = unit.get("conditions")
        record['source_seed']=unit['seed']
        if "title" in unit:
            record["title"] = unit["title"]
        else:
            record.pop("title", None)
        cues.update(timed_cues(unit, record["words"]))
    timeline["cues"] = cues
    timeline["source_sha256"] = digest(source)
    if "captionAliases" in spec:
        timeline["captionAliases"] = spec["captionAliases"]
    else:
        timeline.pop("captionAliases", None)
    with atomic_destination(timeline_path) as candidate:
        candidate.write_text(json.dumps(timeline, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        check_timeline(script_path, candidate, source_directory=source_directory)
    return timeline
