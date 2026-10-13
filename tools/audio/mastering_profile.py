"""The shared FFmpeg profile identity is readable without loading audio/model dependencies."""
import hashlib
import json
from pathlib import Path

PROFILE_BYTES = Path(__file__).with_name("mastering.json").read_bytes()
PROFILE = json.loads(PROFILE_BYTES)
PROFILE_SHA256 = hashlib.sha256(json.dumps(PROFILE, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
