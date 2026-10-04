"""Keep authored attributions while replacing the audio-owned credit section."""
import re

from resources import SPEECH_CREDIT

START = "=== visual-story:audio ==="
END = "=== /visual-story:audio ==="


def music_credit(music):
    if not music:
        return ""
    return (
        f'{music["title"]} — {music["artist"]}\n{music["source"]}\n'
        f'{music["license"]} {music.get("license_url", "")}\n{music["changes"]}\n'
    )


def authored_credits(existing, previous_music=None):
    """Remove only our generated audio attribution, including its previous format."""
    authored = re.sub(
        rf"(?m)^{re.escape(START)}\r?\n.*?^{re.escape(END)}(?:\r?\n|$)",
        "", existing, flags=re.DOTALL,
    )
    authored = authored.replace(SPEECH_CREDIT, "")
    if previous_music:
        authored = authored.replace(music_credit(previous_music), "")
    return authored.strip()


def audio_credits(existing, music, previous_music=None):
    """Migrate exact old generated credits; preserve every other attribution."""
    authored = authored_credits(existing, previous_music)
    generated = SPEECH_CREDIT.rstrip()
    if music:
        generated += "\n\n" + music_credit(music).rstrip()
    return (authored + "\n\n" if authored else "") + f"{START}\n{generated}\n{END}\n"
