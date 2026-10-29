"""BZNSYP labels and evaluation policy; no model-based selection or relabeling."""
import csv
import hashlib
import json
from pathlib import Path
import re
import subprocess
from collections import defaultdict

from check_golden_min_length import HELPERS, feasible
from golden_scoring import SCORING_POLICY, SCORING_DESCRIPTION, u16, score, aggregate

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / 'benchmark/golden/cases.csv'
BACKEND = ROOT / 'src/backend/chunker.js'
ELIGIBILITY_POLICY = 'all-annotated-boundaries-v2'
PROXIES = frozenset('，。！？；…、：,.!?;:')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def parse_labels(marked):
    """Offsets refer to Unicode code points before proxy removal."""
    raw, labels, cursor = '', [], 0
    for match in re.finditer(r'#([1-4])', marked):
        raw += marked[cursor:match.start()]
        labels.append(dict(offset=len(raw), level=int(match[1])))
        cursor = match.end()
    raw += marked[cursor:]
    if '#' in raw or '｜' in raw:
        raise ValueError('Unknown marker or legacy manual-answer format')
    return raw, labels


def mark(text, cuts):
    result, offset = [], 0
    for ch in text:
        if offset in cuts:
            result.append('｜')
        result.append(ch)
        offset += u16(ch)
    return ''.join(result)


def project(marked):
    """Hide only contiguous proxy runs touching #2/#3, retaining quote positions."""
    original, labels = parse_labels(marked)
    remove = set()
    for boundary in labels:
        if boundary['level'] not in (2, 3):
            continue
        left, right = boundary['offset']-1, boundary['offset']
        while left >= 0 and original[left] in PROXIES:
            remove.add(left); left -= 1
        while right < len(original) and original[right] in PROXIES:
            remove.add(right); right += 1
    raw, offsets = '', [0]
    for i, ch in enumerate(original):
        if i not in remove:
            raw += ch
        offsets.append(u16(raw))
    required = [offsets[b['offset']] for b in labels if b['level'] == 3]
    annotated = [offsets[b['offset']] for b in labels if b['level'] in (2, 3)]
    optional = sorted({offsets[b['offset']] for b in labels if b['level'] == 2} - set(required))
    reasons = []
    if not 13 <= len(raw) <= 64:
        reasons.append('sentence_outside_13_to_64')
    if len(required) != len(set(required)):
        reasons.append('collapsed_required_boundaries')
    if len(annotated) != len(set(annotated)):
        reasons.append('collapsed_annotated_boundaries')
    if any(not 0 < p < u16(raw) for p in required):
        reasons.append('required_boundary_at_edge')
    if any(not 0 < p < u16(raw) for p in optional):
        reasons.append('optional_boundary_at_edge')
    return dict(original_text=original, raw=raw, required=required, optional=optional,
                expected=mark(raw, required), with_optional=mark(raw, set(required)|set(optional)),
                removed=[dict(index=i, character=original[i]) for i in sorted(remove)],
                precheck_reasons=reasons)


def load_cases(path=CASES):
    rows = []
    with Path(path).open(encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != ['text', 'source']:
            raise ValueError('Expected text,source CSV columns')
        for row in reader:
            source = re.fullmatch(r'BZNSYP/ProsodyLabeling/000001-010000.txt:(\d+);id=(\d{6})', row['source'])
            if not source:
                raise ValueError('Expected BZNSYP source path, line number and sentence ID')
            rows.append(dict(id=source[2], source_line=int(source[1]), source=row['source'],
                             annotation=row['text'], **project(row['text'])))
    if len({r['id'] for r in rows}) != len(rows):
        raise ValueError('Duplicate source IDs')
    return rows


def audit(rows, backend=BACKEND, thresholds=(12, 13), exclusions=None):
    """Require every original #2/#3 gap to coexist in a legal recursive tree.

    Eligibility uses the full annotation, including its final fragment lengths.
    Scoring remains #3 required / #2 optional.
    """
    exclusions = exclusions or {}
    ready = [r for r in rows if not r['precheck_reasons']]
    result = json.loads(subprocess.check_output(['node', '-e', HELPERS], input=json.dumps(dict(
        backend=str(backend), gapRule='book-title-only',
        rows=[dict(line=r['id'], text=r['with_optional']) for r in ready])), text=True))
    diagnostics = {r['line']:r for r in result['results']}
    for row in rows:
        info = diagnostics.get(row['id'])
        row['thresholds'] = {}
        for minimum in thresholds:
            reasons = list(row['precheck_reasons'])
            if info:
                if info['invalid']:
                    reasons.append('invalid_annotated_gap')
                if any(f['visualLength'] > 13 for c in info['clauses'] for f in c['fragments']):
                    reasons.append('annotated_answer_fragment_over_13')
                if any(not feasible(c['lengths'], minimum) for c in info['clauses']):
                    reasons.append('infeasible_annotated_recursion')
            mechanical = not reasons
            if row['id'] in exclusions:
                reasons.append('known_annotation_error')
            row['thresholds'][str(minimum)] = dict(mechanical=mechanical, reasons=reasons, selected=False)
        row['invalid_gaps'] = info['invalid'] if info else []
    for minimum in thresholds:
        groups = defaultdict(list)
        for row in rows:
            if not row['thresholds'][str(minimum)]['reasons']:
                groups[row['raw']].append(row)
        for group in groups.values():
            conflict = len({(tuple(r['required']),tuple(r['optional'])) for r in group}) > 1
            for index, row in enumerate(group):
                state = row['thresholds'][str(minimum)]
                if conflict:
                    state['reasons'].append('conflicting_annotation_text')
                elif index:
                    state['reasons'].append('duplicate_text')
                else:
                    state['selected'] = True
    return result['environment'], result['minimum']
