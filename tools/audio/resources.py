"""Local model/cache ownership. Only setup performs network I/O."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import urllib.request

CACHE = Path(os.environ.get("SKETCH_AUDIO_CACHE", Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "sketch-visualization"))
SPEECH_REPO = "bosonai/higgs-tts-3-4b"
SPEECH_REVISION = "239f63fb7b02b1aa085f98d9efae5e35cc5523e8"
SPEECH_MODEL = CACHE / "models" / "higgs-tts-3-bf16"
REFERENCE_AUDIO = Path(__file__).resolve().parents[2] / "dist" / "assets" / "audio" / "narrator-male.wav"
REFERENCE_TEXT = (
    "Попробуй представить свой вариант. Может быть, на ковёр? На диван? А может быть, на стул? "
    "Возможных продолжений очень много. Чтобы выбирать осмысленно, машине нужно учиться на примерах: "
    "замечать связи между словами и ситуациями, которые они описывают."
)
# The accepted performance carries the narrator's energy. Stacking enthusiasm
# and expressive_high on every take overdrives questions and short openings.
DEFAULT_DELIVERY = ""
SPEECH_CREDIT = "This audio was created with Boson AI's Higgs Audio — https://www.boson.ai/higgs-audio\n"
ALIGN_REPO = "jonatasgrosman/wav2vec2-large-xlsr-53-russian"
ALIGN_REVISION = "2329100508896c6d9b157019803ab5601e6f3406"
ALIGN_MODEL = CACHE / "models" / "ru-aligner"
MUSIC = CACHE / "music" / "Inspired.mp3"
MUSIC_CREDIT = {
    "title": "Inspired", "artist": "Kevin MacLeod",
    "source": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600022",
    "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/",
}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def file_digest(path):
    with Path(path).open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def download(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".download")
    try:
        urllib.request.urlretrieve(url, temporary)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def speech_ready():
    return all((SPEECH_MODEL / name).is_file() for name in (
        "config.json", "tokenizer.json", "tokenizer_config.json",
        "model.safetensors", "model.safetensors.index.json",
    ))


def setup(music_from=None):
    from huggingface_hub import snapshot_download

    print("Preparing Higgs TTS 3 BF16 (about 9.3 GB, once)", flush=True)
    if not speech_ready():
        snapshot_download(SPEECH_REPO, revision=SPEECH_REVISION, local_dir=SPEECH_MODEL,
                          allow_patterns=["*.json", "*.safetensors", "*.jinja", "LICENSE", "README.md", "PROMPTING.md"],
                          token=False, max_workers=2)
    if not MUSIC.exists():
        MUSIC.parent.mkdir(parents=True, exist_ok=True)
        if music_from:
            shutil.copyfile(music_from, MUSIC)
        else:
            download("https://incompetech.com/music/royalty-free/mp3-royaltyfree/Inspired.mp3", MUSIC)
    print("Preparing Russian word aligner (about 1.3 GB, once)", flush=True)
    snapshot_download(
        ALIGN_REPO, revision=ALIGN_REVISION, local_dir=ALIGN_MODEL, token=False,
        allow_patterns=["config.json", "preprocessor_config.json", "vocab.json", "special_tokens_map.json", "pytorch_model.bin", "README.md"],
        max_workers=4,
    )
    if not REFERENCE_AUDIO.is_file():
        raise FileNotFoundError(f"The skill's bundled narrator is missing: {REFERENCE_AUDIO}")
    receipt = {"speech_model": SPEECH_REPO, "speech_revision": SPEECH_REVISION,
               "reference_sha256": file_digest(REFERENCE_AUDIO),
               "alignment_model": ALIGN_REPO, "alignment_revision": ALIGN_REVISION, "music": MUSIC_CREDIT}
    (CACHE / "resources.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print(f"Local resources ready: {CACHE}", flush=True)


def doctor():
    return {
        "cache": str(CACHE), "speech_model": SPEECH_REPO, "speech_revision": SPEECH_REVISION,
        "speech_ready": speech_ready(), "reference_voice": str(REFERENCE_AUDIO),
        "reference_ready": REFERENCE_AUDIO.is_file(), "delivery": DEFAULT_DELIVERY,
        "aligner": (ALIGN_MODEL / "pytorch_model.bin").exists(),
        "music": MUSIC.exists(), "ffmpeg": shutil.which("ffmpeg"),
    }
