#!/usr/bin/env python3
"""Evaluate prepared Golden threshold cohorts and their common sentence set."""
import argparse
import json
from pathlib import Path
import subprocess

from bznsyp_golden import (ROOT, ELIGIBILITY_POLICY, SCORING_POLICY,
                          SCORING_DESCRIPTION, sha, score, aggregate, mark)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepared', type=Path, default=ROOT/'artifacts/bznsyp-golden-all-boundaries-v2/prepared.json')
    parser.add_argument('--model', type=Path, default=ROOT/'src/boundary-model-data.js')
    parser.add_argument('--inference', type=Path, default=ROOT/'src/backend/inference.js')
    parser.add_argument('--confidence', type=float, default=.45)
    parser.add_argument('--thresholds', type=int, nargs='+', help='Run only these prepared thresholds; common cohort still uses the full preparation plan')
    parser.add_argument('--output', type=Path, default=ROOT/'artifacts/bznsyp-golden-all-boundaries-v2/evaluation-quote-equivalence-v1')
    args = parser.parse_args()
    if not 0 <= args.confidence <= 1:
        parser.error('confidence must lie between 0 and 1')
    plan = json.loads(args.prepared.read_text())
    if plan.get('eligibility_policy') != ELIGIBILITY_POLICY:
        parser.error('Rebuild preparation with full #2+#3 eligibility; old required-only cohorts are historical')
    thresholds = plan['thresholds'] if args.thresholds is None else args.thresholds
    if not thresholds or len(set(thresholds)) != len(thresholds) or any(n not in plan['thresholds'] for n in thresholds):
        parser.error('Requested thresholds must be a nonempty, distinct subset of prepared thresholds')
    bridge = Path(__file__).with_name('golden_bridge.cjs')
    hashes = {**plan['hashes'], **{str(p.resolve()):sha(p) for p in
        [args.prepared,args.model,args.inference,bridge,Path(__file__),Path(__file__).with_name('golden_scoring.py')]}}
    def verify():
        for path, digest in hashes.items():
            if sha(path) != digest:
                raise ValueError(f'Inputs changed; rerun preparation: {path}')
    verify()
    request = dict(backend=plan['backend'], model=str(args.model.resolve()), inference=str(args.inference.resolve()),
                   thresholds=thresholds, cohorts=plan['cohorts'], records=plan['records'], confidence=args.confidence)
    # Inherit stderr for progress; stdout is exclusively the structured result.
    process = subprocess.run(['node',str(bridge)], input=json.dumps(request), text=True, stdout=subprocess.PIPE, check=True)
    prediction = json.loads(process.stdout)
    if prediction['environment'] != {k:plan['environment'][k] for k in ('node','icu')}:
        raise ValueError('Backend environment differs from preparation; rebuild cohorts')
    by_id = {r['id']:r for r in plan['records']}
    groups = {}
    for minimum in thresholds:
        outputs = prediction['results'][str(minimum)]
        if {r['id'] for r in outputs} != set(plan['cohorts'][str(minimum)]) or len(outputs) != len(plan['cohorts'][str(minimum)]):
            raise ValueError('Prediction coverage differs from selected cohort')
        rows = []
        for result in outputs:
            source = by_id[result['id']]
            rows.append(dict(id=source['id'], raw=source['raw'], required=source['required'], optional=source['optional'],
                expected=source['expected'], with_optional=source['with_optional'], actual=mark(source['raw'],result['cuts']),
                **score(source['required'],source['optional'],result['cuts'],text=source['raw'])))
        common_ids=set(plan['common'])
        groups[str(minimum)] = dict(metrics=aggregate(rows), common_metrics=aggregate([r for r in rows if r['id'] in common_ids]), results=rows)
    verify()
    report = dict(dataset=plan['dataset'], eligibility_policy=plan['eligibility_policy'], population=plan['total'], model=prediction['model'],
        confidence=args.confidence, environment=prediction['environment'], hashes=hashes,
        scoring_policy=SCORING_POLICY, scoring=SCORING_DESCRIPTION,
        production_threshold_changed=False, evaluated_thresholds=thresholds,
        common_thresholds=plan['thresholds'], common_cases=len(plan['common']), groups=groups)
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    md = '# BZNSYP Golden: ' + ' / '.join(f'min{n}' for n in thresholds) + '\n\nResearch configurations; production files are unchanged. #3 required; #2 optional. Either side of the same Chinese closing double quote counts as one boundary match.\n\n'
    md += '| Scope | Threshold | Cases | Complete | Incorrect cut rate | Missed required rate |\n|---|---:|---:|---:|---:|---:|\n'
    pct=lambda value:'N/A' if value is None else f'{value*100:.2f}%'
    error=lambda value:None if value is None else 1-value
    for scope,key in [('Own compatible cohort','metrics'),('Same common sentences','common_metrics')]:
        for minimum, group in groups.items():
            m=group[key]
            md+=f'| {scope} | {minimum} | {m["cases"]} | {m["complete"]} ({pct(m["sentence_accuracy"])}) | {pct(error(m["cut_precision"]))} | {pct(error(m["required_coverage"]))} |\n'
    md += '\nUse the common-sentence comparison for threshold effects. Own-cohort scores have different denominators. These are repeatedly inspected evaluation data, not an untouched test set. Detailed missing/extra boundaries and source hashes: report.json.\n'
    (args.output/'report.md').write_text(md)
    print(json.dumps({n:{k:v for k,v in g.items() if k!='results'} for n,g in groups.items()},ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
