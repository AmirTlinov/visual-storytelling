"""Build local Russian voice, a ducked music mix and a shared word timeline."""
import argparse
import json
from pathlib import Path
import sys

from resources import doctor, setup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("setup", help="Prepare pinned local voice and alignment models")
    prep.add_argument("--music-from", type=Path)
    prep.add_argument("--music", action="store_true", help="Prepare the optional credited music track")
    prep.add_argument("--progress-json", action="store_true")
    commands.add_parser("doctor", help="Inspect local resources")
    check = commands.add_parser("check", help="Check a generated timeline against its narration without loading models")
    check.add_argument("script", type=Path)
    check.add_argument("--timeline", type=Path, required=True)
    check.add_argument("--source-directory", type=Path, help="Base for a generated script's authored relative resources")
    build = commands.add_parser("build", help="Build audio.wav, voice.wav and timeline.json from a JSON script")
    build.add_argument("script", type=Path)
    build.add_argument("--out", type=Path, required=True)
    build.add_argument("--source-directory", type=Path, help="Base for a generated script's authored relative resources")
    build.add_argument("--device", choices=["auto", "mps", "cpu"], default="auto", help="Word aligner device; speech uses MLX on Apple Silicon")
    preview = commands.add_parser("audition", help="Compare complete takes of one segment without changing the story")
    preview.add_argument("script", type=Path)
    preview.add_argument("--segment", required=True)
    preview.add_argument("--out", type=Path, required=True)
    preview.add_argument("--seeds", type=int, nargs="+", help="Take seeds; defaults to the selected seed and its two successors")
    preview.add_argument("--device", choices=["auto", "mps", "cpu"], default="auto")
    args = parser.parse_args()
    try:
        if args.command == "setup":
            setup(args.music_from, music=args.music, progress_json=args.progress_json)
        elif args.command == "doctor":
            print(json.dumps(doctor(), ensure_ascii=False, indent=2))
        elif args.command == "check":
            from script import check_timeline
            check_timeline(args.script, args.timeline, source_directory=args.source_directory)
        elif args.command == "audition":
            from audition import audition
            audition(args.script.resolve(), args.segment, args.out.resolve(), args.seeds, args.device)
        else:
            from assembly import build_audio
            build_audio(args.script.resolve(), args.out.resolve(), args.device, source_directory=args.source_directory)
    except (ValueError, RuntimeError, FileNotFoundError) as error:
        print(f"sketch-audio: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
