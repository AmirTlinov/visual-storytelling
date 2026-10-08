"""Pinned model verification and atomic local audio-cache preparation."""
import hashlib
import fcntl
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.request
from contextlib import contextmanager
from fnmatch import fnmatch

CACHE = Path(os.environ.get("SKETCH_AUDIO_CACHE", Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "sketch-visualization"))
MODELS = json.loads(Path(__file__).with_name("models.json").read_text())
SPEECH_REPO = MODELS["speech"]["repository"]
SPEECH_REVISION = MODELS["speech"]["revision"]
SPEECH_MODEL = CACHE / "models" / MODELS["speech"]["directory"]
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
ALIGN_REPO = MODELS["alignment"]["repository"]
ALIGN_REVISION = MODELS["alignment"]["revision"]
ALIGN_MODEL = CACHE / "models" / MODELS["alignment"]["directory"]
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


@contextmanager
def atomic_destination(destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".pending", dir=destination.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        yield temporary
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def cache_lock():
    CACHE.mkdir(parents=True, exist_ok=True)
    with (CACHE / ".resources.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def download(url, destination):
    with atomic_destination(destination) as temporary:
        urllib.request.urlretrieve(url, temporary)


def speech_ready():
    return all((SPEECH_MODEL / name).is_file() for name in MODELS["speech"]["required"])


def atomic_json(path, value):
    with atomic_destination(path) as temporary:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def model_revision_receipt():
    return {key: {"repository": spec["repository"], "revision": spec["revision"]}
            for key, spec in MODELS.items()}


def setup(music_from=None, *, music=False, progress_json=False):
    # CLI and plugin workers share one cache. A stopped owner releases the OS lock.
    with cache_lock():
        _setup(music_from, music=music, progress_json=progress_json)


def _setup(music_from=None, *, music=False, progress_json=False):
    from huggingface_hub import hf_hub_download, model_info
    from tqdm.auto import tqdm

    def report(stage, done=None, total=None):
        if progress_json:
            print(json.dumps({"type": "progress", "stage": stage, "done": done, "total": total}, ensure_ascii=False), flush=True)
        else:
            suffix = f" {done}/{total}" if total else ""
            print(stage + suffix, flush=True)

    verified_path = CACHE / "verified-models.json"
    try:
        verified = json.loads(verified_path.read_text())
    except (FileNotFoundError, ValueError):
        verified = {}

    for kind, spec in MODELS.items():
        title = "Модель речи" if kind == "speech" else "Разметка слов"
        directory = CACHE / "models" / spec["directory"]
        report(f"{title}: проверяю закреплённый комплект")
        prefix = f"{spec['repository']}@{spec['revision']}/"
        owned = {key[len(prefix):]: value for key, value in verified.items() if key.startswith(prefix)}
        def unchanged(name, record):
            path = directory / name
            if not path.is_file():
                return False
            stat = path.stat()
            return stat.st_size == record["size"] and stat.st_mtime_ns == record["mtime"]
        if set(spec["required"]).issubset(owned) and all(unchanged(name, record) for name, record in owned.items()):
            report(f"{title}: использую проверенные файлы")
            continue
        info = model_info(spec["repository"], revision=spec["revision"], files_metadata=True, token=False)
        files = [file for file in info.siblings if any(fnmatch(file.rfilename, pattern) for pattern in spec["patterns"])]
        names = {file.rfilename for file in files}
        if not set(spec["required"]).issubset(names):
            raise RuntimeError(f"Incomplete model manifest: {spec['repository']}")
        for file in files:
            path = directory / file.rfilename
            lfs = file.lfs
            checksum = lfs.sha256 if lfs else file.blob_id
            size = file.size
            algorithm = "sha256" if lfs else "git-sha1"
            key = f"{spec['repository']}@{spec['revision']}/{file.rfilename}"
            previous = verified.get(key)
            stat = path.stat() if path.is_file() else None
            if previous and stat and previous == {"digest": checksum, "size": size, "mtime": stat.st_mtime_ns}:
                continue

            def valid():
                if not path.is_file() or path.stat().st_size != size:
                    return False
                report(f"{title}: проверяю {file.rfilename}")
                if algorithm == "sha256":
                    return file_digest(path) == checksum
                digest = hashlib.sha1(f"blob {size}\0".encode())
                with path.open("rb") as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(block)
                return digest.hexdigest() == checksum

            if not valid():
                report(f"{title}: {file.rfilename} · МБ", 0, max(1, round(size / 1048576)))
                class Progress(tqdm):
                    def update(self, amount=1):
                        result = super().update(amount)
                        report(f"{title}: {file.rfilename} · МБ", round(self.n / 1048576), max(1, round((self.total or size) / 1048576)))
                        return result
                hf_hub_download(spec["repository"], file.rfilename, revision=spec["revision"],
                                local_dir=directory, token=False, force_download=path.is_file(),
                                tqdm_class=Progress if progress_json else None)
                if not valid():
                    path.unlink(missing_ok=True)
                    raise RuntimeError(f"Model integrity check failed: {file.rfilename}")
            verified[key] = {"digest": checksum, "size": size, "mtime": path.stat().st_mtime_ns}
            atomic_json(verified_path, verified)
    if music or music_from:
        _prepare_music(music_from)
    if not REFERENCE_AUDIO.is_file():
        raise FileNotFoundError(f"The bundled narrator is missing: {REFERENCE_AUDIO}")
    receipt = {"speech_model": SPEECH_REPO, "speech_revision": SPEECH_REVISION,
               "reference_sha256": file_digest(REFERENCE_AUDIO), "verified": True,
               "alignment_model": ALIGN_REPO, "alignment_revision": ALIGN_REVISION,
               "models": model_revision_receipt()}
    atomic_json(CACHE / "resources.json", receipt)
    report("Голос и разметка готовы")


def prepare_music(music_from=None):
    with cache_lock():
        _prepare_music(music_from)


def _prepare_music(music_from=None):
    if MUSIC.is_file():
        return
    MUSIC.parent.mkdir(parents=True, exist_ok=True)
    if music_from:
        with atomic_destination(MUSIC) as temporary:
            shutil.copyfile(music_from, temporary)
    else:
        download("https://incompetech.com/music/royalty-free/mp3-royaltyfree/Inspired.mp3", MUSIC)


def doctor():
    try:
        receipt = json.loads((CACHE / "resources.json").read_text())
    except (FileNotFoundError, ValueError):
        receipt = {}
    return {
        "cache": str(CACHE), "speech_model": SPEECH_REPO, "speech_revision": SPEECH_REVISION,
        "speech_ready": speech_ready(), "reference_voice": str(REFERENCE_AUDIO),
        "reference_ready": REFERENCE_AUDIO.is_file(), "delivery": DEFAULT_DELIVERY,
        "aligner": all((ALIGN_MODEL / name).is_file() for name in MODELS["alignment"]["required"]),
        "verified": receipt.get("verified") is True and receipt.get("models") == model_revision_receipt(),
        "music": MUSIC.exists(), "ffmpeg": shutil.which("ffmpeg"),
    }
