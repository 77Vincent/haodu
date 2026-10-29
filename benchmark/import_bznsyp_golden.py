#!/usr/bin/env python3
"""Import all 10,000 official sentences, preserving #2/#3 labels and source text."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import re

from bznsyp_golden import ROOT, sha, parse_labels


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Official 000001-010000.txt annotation file')
    parser.add_argument('--output', type=Path, default=ROOT/'benchmark/golden')
    args = parser.parse_args()
    policy = json.loads((Path(__file__).parent/'golden/source.json').read_text())
    metadata = policy['source']
    if sha(args.source) != metadata['text_sha256']:
        raise ValueError('Source SHA256 mismatch')
    lines = args.source.read_text(encoding='utf-8-sig').splitlines()
    if len(lines) != 20000:
        raise ValueError('Expected 10,000 annotation/pinyin pairs')
    rows = []
    for i in range(0, len(lines), 2):
        match = re.fullmatch(r'(\d{6})\s+(.+)', lines[i])
        if not match or not lines[i+1].startswith('\t') or int(match[1]) != i//2+1:
            raise ValueError(f'Invalid source pair at line {i+1}')
        text = re.sub(r'#[14]', '', match[2])
        original, labels = parse_labels(match[2])
        imported, kept = parse_labels(text)
        assert original == imported and [b for b in labels if b['level'] in (2,3)] == kept
        rows.append(dict(text=text, source=f'BZNSYP/ProsodyLabeling/000001-010000.txt:{i+1};id={match[1]}'))
    buffer = io.StringIO(newline='')
    writer = csv.DictWriter(buffer, fieldnames=['text','source'])
    writer.writeheader(); writer.writerows(rows)
    data = buffer.getvalue().encode('utf-8')
    if hashlib.sha256(data).hexdigest() != policy['cases_sha256']:
        raise ValueError('Imported CSV differs from the fixed benchmark corpus')
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output/'cases.csv').write_bytes(data)
    (args.output/'source.json').write_text(json.dumps(policy, ensure_ascii=False, indent=2)+'\n')
    print(f'Imported {len(rows)} records: {args.output / "cases.csv"}')


if __name__ == '__main__':
    main()
