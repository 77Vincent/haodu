#!/usr/bin/env python3
"""Prepare research cohorts from BZNSYP; default thresholds come from its manifest."""
import argparse
from collections import Counter
import json
from pathlib import Path

from bznsyp_golden import ROOT, CASES, BACKEND, ELIGIBILITY_POLICY, sha, load_cases, audit


def prepare(cases=CASES, backend=BACKEND, thresholds=None):
    metadata_file = cases.with_name('source.json')
    metadata = json.loads(metadata_file.read_text())
    if metadata.get('eligibility_policy') != ELIGIBILITY_POLICY:
        raise ValueError('Golden metadata must declare the current full-annotation eligibility policy')
    if sha(cases) != metadata['cases_sha256']:
        raise ValueError('Golden CSV differs from the imported source; re-import or version the dataset explicitly')
    rows = load_cases(cases)
    if len(rows) != metadata['total']:
        raise ValueError('Golden population differs from manifest')
    thresholds = metadata['evaluation_thresholds'] if thresholds is None else thresholds
    if not thresholds or len(set(thresholds)) != len(thresholds) or any(n not in range(9,17) for n in thresholds):
        raise ValueError('Use distinct research thresholds from 9 through 16')
    environment, production_minimum = audit(rows, backend, thresholds, metadata['exclusions'])
    cohorts = {str(n):[r['id'] for r in rows if r['thresholds'][str(n)]['selected']] for n in thresholds}
    common = sorted(set.intersection(*(set(ids) for ids in cohorts.values())))
    counts = {str(n):dict(mechanical=sum(r['thresholds'][str(n)]['mechanical'] for r in rows),
        selected=len(cohorts[str(n)]), reasons=dict(Counter(reason for r in rows for reason in r['thresholds'][str(n)]['reasons']))) for n in thresholds}
    hashes = {str(p.resolve()):sha(p) for p in [cases, metadata_file, backend,
              Path(__file__), Path(__file__).with_name('bznsyp_golden.py'), Path(__file__).with_name('check_golden_min_length.py')]}
    report = dict(dataset=metadata['version'], eligibility_policy=ELIGIBILITY_POLICY, total=len(rows), thresholds=thresholds,
        production_minimum=production_minimum, backend=str(backend.resolve()),
        environment=environment, hashes=hashes, counts=counts, cohorts=cohorts, common=common,
        policy='Eligibility checks the complete original #2+#3 annotation: every gap passes guards, all gaps coexist in a legal recursive tree, and final annotated leaves are <=13 visual units. Input 13..64 codepoints; remove touching proxies without moving quote-adjacent labels. Scoring remains #3 required / #2 optional. Known-error IDs excluded; full source retained.',
        records=rows)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, default=CASES)
    parser.add_argument('--backend', type=Path, default=BACKEND)
    parser.add_argument('--thresholds', type=int, nargs='+', help='Research override (9 through 16); does not change dataset defaults or production')
    parser.add_argument('--output', type=Path, default=ROOT/'artifacts/bznsyp-golden-all-boundaries-v2')
    args = parser.parse_args()
    report = prepare(args.cases, args.backend, args.thresholds)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output/'prepared.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    summary={k:v for k,v in report.items() if k not in ('records','cohorts','common','hashes')}
    summary['common_cases']=len(report['common'])
    (args.output/'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
