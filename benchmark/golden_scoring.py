"""Score required/optional boundaries with closing-double-quote equivalence.

All boundary offsets are UTF-16 units, matching JavaScript inference output.
This module does not modify annotations, select cases, or run the model.
"""
from collections import defaultdict


SCORING_POLICY = 'right-double-quote-equivalence-v1'


SCORING_DESCRIPTION = (
    '#3 required; #2 optional. Match predictions to annotations one-to-one, '
    'accepting either side of the same Chinese closing double quote (U+201D). '
    'Match required annotations first. Precision = matched predictions / all '
    'predictions; recall = matched #3 annotations / all #3. Complete = no '
    'unmatched predictions or required annotations. No mixed-denominator F1.'
)


def u16(text):
    return len(text.encode('utf-16-le')) // 2


def score(required, optional, predicted, *, text=None):
    """Match boundaries once, optionally across one Chinese closing double quote.

    Raw labels and prediction offsets stay unchanged. Omitting text preserves
    strict matching for historical callers; current evaluations must pass it.
    Required annotations take priority over optional ones when aliases overlap.
    """
    required, optional, predicted = set(required), set(optional), set(predicted)
    if required & optional:
        raise ValueError('Required and optional boundaries overlap')
    aliases = defaultdict(set)
    if text is not None:
        offset, end = 0, u16(text)
        for ch in text:
            following = offset + u16(ch)
            if ch == '”' and 0 < offset < following < end:
                aliases[offset].add(following)
                aliases[following].add(offset)
            offset = following
    candidates = {gap: sorted(({gap} | aliases[gap]) & predicted,
                              key=lambda p: (p != gap, p))
                  for gap in required | optional}
    owners = {}  # prediction -> original annotation

    def match(gap, seen):
        for prediction in candidates[gap]:
            if prediction in seen:
                continue
            seen.add(prediction)
            if prediction not in owners or match(owners[prediction], seen):
                owners[prediction] = gap
                return True
        return False

    for gap in sorted(required):
        match(gap, set())
    for gap in sorted(optional):
        match(gap, set())
    valid, matched = set(owners), set(owners.values())
    missing, invalid = required-matched, predicted-valid
    return dict(cuts=sorted(predicted), valid=sorted(valid), invalid=sorted(invalid),
                missing=sorted(missing), required_hits=len(required & matched),
                optional_hits=len(optional & matched), complete=not (missing or invalid),
                matches=[dict(expected=owners[p], predicted=p,
                              level=3 if owners[p] in required else 2,
                              quote_equivalent=p != owners[p]) for p in sorted(owners)])


def aggregate(rows):
    predicted = sum(len(r['cuts']) for r in rows)
    valid = sum(len(r['valid']) for r in rows)
    required = sum(len(r['required']) for r in rows)
    hits = sum(r['required_hits'] for r in rows)
    complete = sum(r['complete'] for r in rows)
    return dict(cases=len(rows), complete=complete, predicted_cuts=predicted, valid_cuts=valid,
                invalid_cuts=predicted-valid, required_cuts=required, required_hits=hits,
                required_misses=required-hits, optional_hits=sum(r['optional_hits'] for r in rows),
                cut_precision=valid/predicted if predicted else None,
                required_coverage=hits/required if required else None,
                sentence_accuracy=complete/len(rows) if rows else None)
