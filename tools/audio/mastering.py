"""Measured static gain: preserve the performance, samples and additive stems."""
import json
import math
import subprocess

import numpy as np
import soundfile as sf

from mastering_profile import PROFILE, PROFILE_SHA256


def validate_audio(audio):
    if not len(audio) or not np.isfinite(audio).all() or not np.any(audio):
        raise ValueError("Narration audio must be finite, non-empty and non-silent")
    return audio


def active_rms(audio):
    validate_audio(audio)
    active = audio[np.abs(audio) > float(np.max(np.abs(audio))) * PROFILE["active_peak_ratio"]]
    return float(np.sqrt(np.mean(active.astype(np.float64) ** 2)))


def measure(path, channels):
    result = subprocess.run([
        "ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", str(path),
        "-af", f'loudnorm=I={PROFILE["integrated_lufs"]}:TP={PROFILE["true_peak_dbtp"]}:LRA=50:dual_mono={str(channels == 1).lower()}:print_format=json',
        "-f", "null", "-",
    ], capture_output=True, text=True, check=True)
    start = result.stderr.rfind("{")
    if start < 0:
        raise RuntimeError("FFmpeg did not report narration loudness")
    measured = json.JSONDecoder().raw_decode(result.stderr[start:])[0]
    def number(key):
        value = float(measured[key])
        return value if math.isfinite(value) else None
    return {"integrated_lufs": number("input_i"), "true_peak_dbtp": number("input_tp")}


def master(stems, output, sample_rate):
    """Write final stems and audio; every output retains exactly the input sample count."""
    voice = validate_audio(stems["voice"])
    bed = stems.get("music")
    combined = voice if bed is None else voice[:, None] + validate_audio(bed)
    validate_audio(combined)
    channels = 1 if combined.ndim == 1 else combined.shape[1]
    temporary = output / ".master-source.wav"
    try:
        sf.write(temporary, combined, sample_rate, subtype="FLOAT")
        before = measure(temporary, channels)
        loudness = before["integrated_lufs"]
        method = "integrated-lufs" if loudness is not None else "short-rms"
        desired = (PROFILE["integrated_lufs"] - loudness if loudness is not None else
                   PROFILE["short_rms_dbfs"] - 20 * math.log10(active_rms(combined)))
        # A sample peak is also required for DC/very short clips the R128 meter cannot measure.
        peak = max(before["true_peak_dbtp"] if before["true_peak_dbtp"] is not None else -999,
                   20 * math.log10(float(np.max(np.abs(combined)))))
        # Opposite-polarity stems can cancel in the mix. Bound each stem too so
        # applying the shared gain never clips its separate PCM16 delivery.
        if bed is not None:
            for stem in (voice, bed):
                sf.write(temporary, stem, sample_rate, subtype="FLOAT")
                stem_peak = measure(temporary, 1 if stem.ndim == 1 else stem.shape[1])["true_peak_dbtp"]
                peak = max(peak, stem_peak if stem_peak is not None else -999,
                           20 * math.log10(float(np.max(np.abs(stem)))))
        # Reserve 0.02 dB for PCM16 rounding and meter precision.
        gain_db = min(desired, PROFILE["true_peak_dbtp"] - .02 - peak)
        gain = 10 ** (gain_db / 20)
        sf.write(output / "voice.wav", voice * gain, sample_rate, subtype="PCM_16")
        if bed is not None:
            sf.write(output / "music.wav", bed * gain, sample_rate, subtype="PCM_16")
        sf.write(output / "audio.wav", combined * gain, sample_rate, subtype="PCM_16")
        audio, rate = sf.read(output / "audio.wav", dtype="float32")
        validate_audio(audio)
        if rate != sample_rate or audio.shape != combined.shape:
            raise RuntimeError("Mastering changed the narration sample count or channels")
        after = measure(output / "audio.wav", channels)
        if after["true_peak_dbtp"] is not None and after["true_peak_dbtp"] > PROFILE["true_peak_dbtp"] + .01:
            raise RuntimeError("Mastered narration exceeds its true-peak ceiling")
        return {"profile_sha256": PROFILE_SHA256, "version": PROFILE["version"], "method": method,
                "gain_db": round(gain_db, 6), "peak_limited": gain_db < desired - .03, **after}
    finally:
        temporary.unlink(missing_ok=True)
