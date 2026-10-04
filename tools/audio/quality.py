"""Detect an acoustically unsupported passage, including at either end of a cached take."""
import math

class AlignmentQualityError(RuntimeError):
    pass


def validate_alignment(words):
    if not isinstance(words, list) or not words:
        raise AlignmentQualityError('Speech has no aligned words')
    if any(not isinstance(word, dict) or not isinstance(word.get('text'), str) or not word['text'].strip() for word in words):
        raise AlignmentQualityError('Speech has invalid aligned words')
    scores = [word.get('score') for word in words]
    if any(type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1 for score in scores):
        raise AlignmentQualityError('Speech has invalid alignment scores')
    mean = sum(scores) / len(scores)
    if mean < .2:
        raise AlignmentQualityError(f'Alignment confidence is too low ({mean:.2f})')
    # One difficult word can have a weak CTC score. A whole unsupported phrase cannot
    # be rescued by the good mean of a long preceding passage.
    for index in range(len(words) - 3):
        window = words[index:index + 4]
        if sum(w['score'] for w in window) / 4 < .12:
            phrase = ' '.join(w['text'] for w in window)
            raise AlignmentQualityError(f'Speech does not support the passage: {phrase!r}')
    return words


def complete_take(speaker, aligner, segment, attempts=3):
    """Retry an entire thought with deterministic seeds; cached audio faces the same check."""
    failures = []
    for attempt in range(attempts):
        take = {**segment, 'seed': (segment['seed'] + attempt) % (2**32)}
        audio, key, synthesis = speaker.synthesize(take)
        try:
            aligned, timing = aligner.align(audio, take['spoken'], key)
            validate_alignment(aligned)
            return take, audio, aligned, synthesis, timing, failures
        except AlignmentQualityError as error:
            failures.append({'seed': take['seed'], 'reason': str(error)})
    raise AlignmentQualityError(f'{segment["id"]}: no complete speech take after {attempts} attempts; {failures[-1]["reason"]}')
