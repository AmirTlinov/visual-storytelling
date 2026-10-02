"""Build local Russian voice, a ducked music mix and a shared word timeline."""
import argparse
import json
from pathlib import Path
import sys

from resources import doctor, setup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("setup", help="Download local models and a credited example music track once")
    prep.add_argument("--music-from", type=Path)
    commands.add_parser("doctor", help="Inspect local resources")
    build = commands.add_parser("build", help="Build audio.wav, voice.wav and timeline.json from a JSON script")
    build.add_argument("script", type=Path)
    build.add_argument("--out", type=Path, required=True)
    build.add_argument("--device", choices=["auto", "mps", "cpu"], default="auto", help="Word aligner device; speech uses MLX on Apple Silicon")
    args = parser.parse_args()
    try:
        if args.command == "setup":
            setup(args.music_from)
        elif args.command == "doctor":
            print(json.dumps(doctor(), ensure_ascii=False, indent=2))
        else:
            from assembly import build_audio
            build_audio(args.script.resolve(), args.out.resolve(), args.device)
    except (ValueError, RuntimeError, FileNotFoundError) as error:
        print(f"sketch-audio: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
