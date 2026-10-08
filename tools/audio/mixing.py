"""Sample-aligned stems and a quiet, automatically ducked music bed."""
from pathlib import Path
import subprocess

import numpy as np
import soundfile as sf

from resources import MUSIC, MUSIC_CREDIT, file_digest
from speech import SAMPLE_RATE


def mix(voice, music_spec, output):
    sf.write(output / "voice.wav", voice, SAMPLE_RATE, subtype="PCM_16")
    duration = len(voice) / SAMPLE_RATE
    credit = None
    if music_spec is None:
        sf.write(output / "audio.wav", voice, SAMPLE_RATE, subtype="PCM_16")
    else:
        source = Path(music_spec.get("path", MUSIC))
        if not source.exists():
            raise FileNotFoundError(f"Music is missing: {source}")
        credit = dict(music_spec.get("credit", MUSIC_CREDIT))
        raw = subprocess.check_output([
            "ffmpeg", "-v", "error", "-stream_loop", "-1", "-ss", str(music_spec["offset"]),
            "-i", str(source), "-t", str(duration), "-af", "highpass=f=100,lowpass=f=6500",
            "-ar", str(SAMPLE_RATE), "-ac", "2", "-f", "f32le", "pipe:1",
        ])
        bed = np.frombuffer(raw, dtype="<f4").copy().reshape(-1, 2)
        if not len(bed) or not np.isfinite(bed).all():
            raise ValueError("Music decoder returned empty or invalid audio")
        if len(bed) < len(voice):
            raise ValueError("Music did not fill the requested timeline; choose an earlier offset")
        bed = bed[:len(voice)]
        # Measure voiced frames so pauses do not change the relative music level.
        active = voice[np.abs(voice) > .01]
        voice_rms = np.sqrt(np.mean(active.astype(np.float64) ** 2))
        music_rms = np.sqrt(np.mean(bed.astype(np.float64) ** 2))
        if music_rms < 1e-7:
            raise ValueError("Selected music excerpt is silent")
        gain = float(voice_rms / music_rms * 10 ** (music_spec["level_db"] / 20))
        bed *= gain
        for length, at_end in [(min(.8, duration / 3), False), (min(1.3, duration / 3), True)]:
            n = round(length * SAMPLE_RATE)
            ramp = np.linspace(0, 1, n, dtype=np.float32)
            if at_end:
                bed[-n:] *= ramp[::-1, None]
            else:
                bed[:n] *= ramp[:, None]
        # Float stem avoids clipping before the sidechain compressor and limiter.
        temporary = output / ".music-source.wav"
        sf.write(temporary, bed, SAMPLE_RATE, subtype="FLOAT")
        # Flush both inputs beyond their final partial audio block, then trim
        # to the exact montage length. FFmpeg's sidechain can otherwise stop
        # on the first input EOF before consuming the other's final block.
        graph = (
            "[0:a]apad=pad_dur=1[sc];[1:a]apad=pad_dur=1[music];"
            "[music][sc]sidechaincompress=threshold=0.035:ratio=4:attack=35:release=450:knee=4,"
            f"atrim=end_sample={len(voice)}[bed]"
        )
        try:
            ducked = subprocess.check_output([
                "ffmpeg", "-y", "-v", "error", "-i", str(output / "voice.wav"), "-i", str(temporary),
                "-filter_complex", graph, "-map", "[bed]", "-ar", str(SAMPLE_RATE), "-ac", "2",
                "-f", "f32le", "pipe:1",
            ])
        finally:
            temporary.unlink(missing_ok=True)
        bed = np.frombuffer(ducked, dtype="<f4").reshape(-1, 2)
        if len(bed) != len(voice):
            raise RuntimeError("The ducked music stem does not match the narration sample count")
        combined = voice[:, None] + bed
        # One static headroom adjustment keeps stems additive and avoids latency.
        headroom = min(1.0, .96 / max(float(np.max(np.abs(combined))), 1e-7))
        sf.write(output / "voice.wav", voice * headroom, SAMPLE_RATE, subtype="PCM_16")
        sf.write(output / "music.wav", bed * headroom, SAMPLE_RATE, subtype="PCM_16")
        sf.write(output / "audio.wav", combined * headroom, SAMPLE_RATE, subtype="PCM_16")
        credit.update(source_sha256=file_digest(source), offset=music_spec["offset"],
                      level_db=music_spec["level_db"], gain=gain, master_gain=headroom,
                      changes="Excerpt, EQ, fades, automatic ducking and mix with narration.")
    audio, sr = sf.read(output / "audio.wav", dtype="float32")
    if sr != SAMPLE_RATE or len(audio) != len(voice) or not np.isfinite(audio).all():
        raise RuntimeError("The final audio does not match the narration timeline")
    peak = float(np.max(np.abs(audio)))
    if peak >= .98:
        raise RuntimeError(f"Unexpected output peak: {peak}")
    return {"peak": round(peak, 4), "music": credit}
