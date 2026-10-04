"""Narration input and named cues, independent of any visual scenario."""
import json
import math
from pathlib import Path
import re
import wave
from resources import DEFAULT_DELIVERY, REFERENCE_AUDIO, REFERENCE_TEXT, MUSIC, digest, file_digest
from quality import validate_alignment

WORD = re.compile(r"[А-Яа-яЁё]+(?:[-‑][А-Яа-яЁё]+)*")
ID = re.compile(r"[a-z][a-z0-9_.-]*\Z")
TAG = re.compile(r"<\|([a-z]+):([a-z_]+)\|>")
CONTROLS = {
    "emotion": set("elation amusement enthusiasm determination pride contentment affection relief contemplation confusion surprise awe longing arousal anger fear disgust bitterness sadness shame helplessness".split()),
    "style": {"singing", "shouting", "whispering"},
    "prosody": set("speed_very_slow speed_slow speed_fast speed_very_fast pause long_pause pitch_low pitch_high expressive_high expressive_low".split()),
    "sfx": set("cough laughter crying screaming burping humming sigh sniff sneeze".split()),
}


def dependency_digests(spec):
    """Resolved input bytes determine whether an accepted mix is still current."""
    music = Path(spec["music"].get("path", MUSIC)) if spec.get("music") else None
    return {"reference_audio": file_digest(spec["voice"]["reference_audio"]),
            # A credited bundled music track need not be installed to reuse a finished mix.
            "music": file_digest(music) if music and music.is_file() else None}


def check_timeline(script_path, timeline_path, *, source_directory=None):
    """Keep generated speech and cues attached to the exact authored source."""
    source = json.loads(Path(script_path).read_text(encoding="utf-8"))
    timeline = json.loads(Path(timeline_path).read_text(encoding="utf-8"))
    if timeline.get("source_sha256") != digest(source):
        raise ValueError("Narration changed after audio generation; run visual-story audio . before building")
    spec = read_script(Path(script_path), source_directory=source_directory)
    inputs = dependency_digests(spec)
    if timeline.get("synthesis", {}).get("reference_sha256") != inputs["reference_audio"]:
        raise ValueError("Voice reference changed after audio generation; run visual-story audio")
    if inputs["music"] and (timeline.get("mix", {}).get("music") or {}).get("source_sha256") != inputs["music"]:
        raise ValueError("Music changed after audio generation; run visual-story audio")
    segments = timeline.get("segments")
    if (not isinstance(segments, list) or any(not isinstance(s, dict) for s in segments) or
            [s.get("id") for s in segments] != [s["id"] for s in spec["segments"]]):
        raise ValueError("Narration has incomplete aligned segments; run visual-story audio")
    cues, previous = {}, 0.0
    for source_segment, segment in zip(spec["segments"], segments, strict=True):
        aligned = validate_alignment(segment.get("words"))
        if normalized(" ".join(w["text"] for w in aligned)) != normalized(source_segment["spoken"]):
            raise ValueError(f'{segment["id"]}: aligned words do not match the complete narration')
        for word in aligned:
            start, end = word.get("start"), word.get("end")
            if (any(type(value) not in (int, float) or not math.isfinite(value) for value in (start, end))
                    or start < previous or end <= start):
                raise ValueError(f'{segment["id"]}: invalid aligned word times')
            previous = end
        if (segment.get("text") != source_segment["spoken"] or
                segment.get("title") != source_segment.get("title") or
                segment.get("start") != aligned[0]["start"] or segment.get("end") != aligned[-1]["end"]):
            raise ValueError(f'{segment["id"]}: narration segment differs from its aligned words')
        cues.update(timed_cues(source_segment, aligned))
    if timeline.get("cues") != cues:
        raise ValueError("Narration cues differ from the aligned script; run visual-story audio")
    audio = timeline.get("audio")
    if not isinstance(audio, str) or not audio:
        raise ValueError("Narration has no generated audio; run visual-story audio")
    try:
        with wave.open(str(Path(timeline_path).parent / audio), 'rb') as wav:
            count, rate = wav.getnframes(), wav.getframerate()
            if (count < 1 or rate < 1 or timeline.get("sample_rate") != rate or
                    type(timeline.get("duration")) not in (int, float) or
                    not math.isfinite(timeline["duration"]) or
                    abs(timeline["duration"] - count / rate) > 1 / rate or
                    previous > count / rate + 1 / rate):
                raise ValueError("Narration audio does not match its timeline; run visual-story audio")
            # Check the advertised final frame without loading a full narrated film.
            wav.setpos(count - 1)
            if len(wav.readframes(1)) != wav.getnchannels() * wav.getsampwidth():
                raise ValueError("Narration audio does not match its timeline; run visual-story audio")
    except (FileNotFoundError, wave.Error, EOFError) as error:
        raise ValueError("Narration audio is missing or invalid; run visual-story audio") from error


def without_controls(text):
    for match in TAG.finditer(text):
        if match[2] not in CONTROLS.get(match[1], set()):
            raise ValueError(f"Unsupported Higgs control: {match[0]}")
    return TAG.sub("", text)


def delivery(value):
    if not isinstance(value, str) or without_controls(value).strip():
        raise ValueError("delivery must contain only native Higgs controls, or be empty")
    return value


def words(text):
    return [m.group() for m in WORD.finditer(without_controls(text))]


def normalized(text):
    return [w.lower().replace("ё", "е").replace("‑", "-") for w in words(text)]


def speech_passages(segment):
    """Prepare whole sentences while retaining one authored segment and its cues."""
    if len(words(segment["spoken"])) <= 40:
        return [segment]
    text = segment["text"]
    ends = [match.end() for match in re.finditer(r'[.!?…][»”\"\']*(?:\s+|$)', text)]
    if not ends or ends[-1] < len(text):
        ends.append(len(text))
    groups, group, count, start = [], [], 0, 0
    for end in ends:
        sentence = text[start:end].strip()
        start = end
        size = len(words(sentence))
        if size > 50:
            raise ValueError(f'{segment["id"]}: one spoken sentence has {size} words; '
                             'add a natural sentence boundary (at most 50 words per sentence)')
        if group and count + size > 40:
            groups.append(" ".join(group))
            group, count = [], 0
        group.append(sentence)
        count += size
    if group:
        groups.append(" ".join(group))
    if len(groups) == 1:
        return [segment]
    return [{**segment, "text": text, "spoken": " ".join(without_controls(text).split())}
            for text in groups]


def number(value, label, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{label} must be between {low} and {high}")
    return float(value)


def seed(value, label):
    if type(value) is not int or not 0 <= value < 2**32:
        raise ValueError(f"{label} must be an integer from 0 to 4294967295")
    return value


def caption_aliases(value, segments):
    """Display aliases refer to whole spoken phrases; they never alter synthesis."""
    if not isinstance(value, dict):
        raise ValueError("captionAliases must map spoken phrases to plain display text")
    seen = set()
    for spoken, display in value.items():
        if any(not isinstance(text, str) or not text.strip() or re.search(r"[<>\x00-\x1f]", text)
               for text in (spoken, display)):
            raise ValueError("captionAliases needs non-empty plain spoken phrases and display text")
        key = " ".join(spoken.lower().replace("ё", "е").split())
        if key in seen:
            raise ValueError(f"Duplicate captionAliases phrase: {spoken}")
        seen.add(key)
        phrase = r"\s+".join(re.escape(word) for word in key.split())
        pattern = re.compile(rf"(?<!\w)(?:{phrase})(?!\w)")
        if not any(pattern.search(segment["spoken"].lower().replace("ё", "е")) for segment in segments):
            raise ValueError(f"captionAliases phrase is missing from spoken text: {spoken}")


def read_script(path, *, source_directory=None):
    base = Path(source_directory) if source_directory is not None else path.parent
    spec = json.loads(path.read_text())
    if spec.get("version") != 3:
        raise ValueError("Script version must be 3; use native Higgs delivery controls")
    spec["intro"] = number(spec.get("intro", .65), "intro", 0, 30)
    spec["outro"] = number(spec.get("outro", 1.0), "outro", 0, 30)
    voice = spec.setdefault("voice", {})
    if set(voice) - {"delivery", "seed", "reference_audio", "reference_text"}:
        raise ValueError("voice accepts delivery, seed, reference_audio and reference_text")
    voice["delivery"] = delivery(voice.get("delivery", DEFAULT_DELIVERY))
    voice["seed"] = seed(voice.get("seed", 42), "voice.seed")
    if bool(voice.get("reference_audio")) != bool(voice.get("reference_text")):
        raise ValueError("Provide both voice.reference_audio and its exact reference_text")
    if voice.get("reference_audio"):
        if not isinstance(voice["reference_text"], str) or not voice["reference_text"].strip():
            raise ValueError("voice.reference_text must contain the exact spoken reference transcript")
        voice["reference_audio"] = str((base / voice["reference_audio"]).resolve())
        if not Path(voice["reference_audio"]).is_file():
            raise ValueError("Voice reference audio does not exist")
    else:
        voice["reference_audio"] = str(REFERENCE_AUDIO)
        voice["reference_text"] = REFERENCE_TEXT
    segments = spec.get("segments")
    if not isinstance(segments, list) or not segments:
        raise ValueError("Provide a non-empty segments array")
    ids = set()
    for segment in segments:
        sid = segment.get("id", "")
        if not ID.fullmatch(sid) or sid in ids:
            raise ValueError(f"Invalid or duplicate segment id: {sid}")
        ids.add(sid)
    for segment in segments:
        sid = segment["id"]
        if "title" in segment and (not isinstance(segment["title"], str) or not segment["title"].strip()):
            raise ValueError(f"{sid}: title must be a non-empty chapter heading")
        if not isinstance(segment.get("text"), str) or not segment["text"].strip() or "ssml" in segment or "rate" in segment:
            raise ValueError(f"{sid}: provide Russian text with optional native Higgs controls")
        text = " ".join(without_controls(segment["text"]).split())
        if any(char in text for char in "[]<>*+\u0301"):
            raise ValueError(f"{sid}: use plain Russian spelling and native Higgs controls")
        # Author the spoken form explicitly: 23, CPU and formulas have ambiguous
        # pronunciations. The JS drawing can display any notation independently.
        if re.search(r"[0-9A-Za-z]", text) or not words(text):
            raise ValueError(f"{sid}: write spoken numbers, abbreviations and formulas in Russian words")
        if len(text) > 1000:
            raise ValueError(f"{sid}: split this narration into shorter semantic phrases (max 1000 characters)")
        segment["spoken"] = text
        segment["delivery"] = delivery(segment.get("delivery", voice["delivery"]))
        segment["seed"] = seed(segment.get("seed", voice["seed"]), f"{sid}.seed")
        segment["pause_after"] = number(segment.get("pause_after", 0), f"{sid}.pause_after", 0, 30)
        tokens = normalized(text)
        for cue in segment.setdefault("cues", []):
            cid = cue.get("id", "")
            if not ID.fullmatch(cid) or cid in ids:
                raise ValueError(f"Invalid or duplicate cue id: {cid}")
            ids.add(cid)
            if ("action" in cue and "hold" in cue) or any(
                not isinstance(cue[key], str) or not cue[key].strip()
                for key in ("action", "hold") if key in cue
            ):
                raise ValueError(f"{cid}: provide either a non-empty action or hold")
            quote = normalized(cue.get("quote", ""))
            matches = [i for i in range(len(tokens) - len(quote) + 1) if tokens[i:i + len(quote)] == quote] if quote else []
            occurrence = cue.get("occurrence")
            if not matches or (len(matches) > 1 and occurrence is None):
                raise ValueError(f"{cid}: quote is missing or ambiguous; set occurrence (1-based) when repeated")
            occurrence = 1 if occurrence is None else occurrence
            if not isinstance(occurrence, int) or not 1 <= occurrence <= len(matches):
                raise ValueError(f"{cid}: occurrence does not exist")
            cue["word_start"] = matches[occurrence - 1]
            cue["word_end"] = cue["word_start"] + len(quote)
    if "captionAliases" in spec:
        caption_aliases(spec["captionAliases"], segments)
    music = spec.get("music")
    if music is not None:
        if not isinstance(music, dict) or not (music.get("path") or music.get("track") == "inspired"):
            raise ValueError("music needs a local path or track: inspired; use null for no music")
        if music.get("path"):
            music["path"] = str((base / music["path"]).resolve())
            if not Path(music["path"]).is_file():
                raise ValueError("Music file does not exist")
            credit = music.get("credit", {})
            if not all(credit.get(k) for k in ("title", "artist", "source", "license")):
                raise ValueError("Custom music needs credit: title, artist, source, license")
        music["offset"] = number(music.get("offset", 0), "music.offset", 0, 86400)
        music["level_db"] = number(music.get("level_db", -19), "music.level_db", -40, -8)
    return spec


def timed_cues(segment, aligned_words):
    """Bind visible intentions to the same aligned words that drive playback."""
    cues = {segment["id"]: {
        "text": segment["spoken"], "start": aligned_words[0]["start"], "end": aligned_words[-1]["end"],
    }}
    for cue in segment["cues"]:
        selected = aligned_words[cue["word_start"]:cue["word_end"]]
        cues[cue["id"]] = {
            "text": " ".join(word["text"] for word in selected),
            "start": selected[0]["start"], "end": selected[-1]["end"],
            **{key: cue[key] for key in ("action", "hold") if key in cue},
        }
    return cues
