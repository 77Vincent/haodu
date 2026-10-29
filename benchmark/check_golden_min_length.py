#!/usr/bin/env python3
"""Check BZNSYP Golden cohorts at both 12 and 13, or explicit legacy manual cases.

Final fragments must also be at most 13 backend visual units (golden policy).
Also enforce adjacent source Han, normalized token gaps and backend word protection.
No weights, inference, confidence or semantic judgment. Exit 1 means infeasible golden cases exist.
"""
import argparse
import csv
from functools import lru_cache
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def feasible(lengths, minimum):
    """lengths[i][j] is backend visual length of consecutive leaves i..j-1."""
    @lru_cache(None)
    def visit(start, end):
        if end - start <= 1:
            return True
        return lengths[start][end] >= minimum and any(
            visit(start, cut) and visit(cut, end)
            for cut in range(start + 1, end)
        )
    return visit(0, len(lengths) - 1)


# Run only backend text helpers in an isolated context; never load the model.
HELPERS = r'''
const fs=require('fs'),vm=require('vm');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const source=fs.readFileSync(input.backend,'utf8');
const minimum=Number(source.match(/const MIN_SPLIT_VISUAL_LENGTH\s*=\s*(\d+)\s*;/)?.[1]);
if(!minimum)throw Error('Cannot read backend minimum threshold');
const context=vm.createContext({Intl,HaoduModelBackend:{getModelInfo:()=>({inputRepresentation:'unicode-context-v1'}),scoreTokens:()=>{throw Error('Inference forbidden')}}});
vm.runInContext(source,context);
const api=context.HaoduChunker;
const results=input.rows.map(row=>{
 let text='',cuts=[];
 for(const ch of row.text){if(ch==='｜')cuts.push(text.length);else text+=ch;}
 let offset=0,clauses=[];
 const invalid=[];
 if(cuts.some((p,i)=>p===0||p===text.length||(i>0&&cuts[i-1]===p)))invalid.push('Empty answer fragment');
 for(const clause of api.splitClauses(text)){
  const end=offset+clause.length;
  const local=cuts.filter(p=>p>offset&&p<end).map(p=>p-offset);
  for(const p of cuts)if(p===end)invalid.push('Added cut coincides with natural clause boundary at '+p);
  const segmenter=api.createSegmenter();
  const tokens=api.tokenizeContext(clause);
  const tokenGaps=new Set(tokens.slice(1).filter((t,i)=>t.index>tokens[i].index).map(t=>t.index));
  for(const p of local){
   const left=Array.from(clause.slice(0,p)).at(-1),right=Array.from(clause.slice(p))[0];
   if((input.gapRule||'adjacent-han')==='book-title-only'){
    if(/[《》]/u.test(left||'')||/[《》]/u.test(right||''))invalid.push('Cut touches a book-title mark at '+(offset+p));
   }else if(!/\p{Script=Han}/u.test(left||'')||!/\p{Script=Han}/u.test(right||'')){
    invalid.push('Cut is not between adjacent source Han characters at '+(offset+p)+': '+JSON.stringify(left)+' | '+JSON.stringify(right));
   }
   if(!tokenGaps.has(p))invalid.push('Cut is not a normalized token boundary at '+(offset+p));
   if(api.boundaryFallsInsideWord(clause,p,segmenter)){
    const word=Array.from(segmenter.segment(clause)).find(w=>w.isWordLike&&p>w.index&&p<w.index+w.segment.length);
    invalid.push('Cut falls inside protected word at '+(offset+p)+': '+JSON.stringify(word.segment));
   }
  }
  const edges=[0,...local,clause.length];
  const lengths=edges.map((a,i)=>edges.map((b,j)=>j>i?api.visualLength(clause.slice(a,b)):0));
  const fragments=edges.slice(0,-1).map((a,i)=>({text:clause.slice(a,edges[i+1]),visualLength:lengths[i][i+1]}));
  clauses.push({text:clause,cuts:local,lengths,fragments});offset=end;
 }
 if(offset!==text.length)throw Error('Clause reconstruction differs');
 return {line:row.line,text:row.text,invalid,clauses};
});
process.stdout.write(JSON.stringify({minimum,results,environment:{node:process.version,icu:process.versions.icu,locale:api.createSegmenter()?.resolvedOptions().locale}}));
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, default=ROOT/'benchmark/golden/cases.csv')
    parser.add_argument('--backend', type=Path, default=ROOT/'src/backend/chunker.js')
    parser.add_argument('--json', type=Path, help='Optional diagnostic report; never changes cases')
    parser.add_argument('--gap-rule', choices=['adjacent-han', 'book-title-only'], default='book-title-only', help='Current title-mark rule; adjacent-han is for historical manual-case checks only')
    args = parser.parse_args()
    with args.cases.open(newline='', encoding='utf-8') as stream:
        reader = csv.DictReader(stream)
        rows = [{'line': reader.line_num, **row} for row in reader]
    if rows and all(row['source'].startswith('BZNSYP/') for row in rows):
        if args.gap_rule != 'book-title-only':
            parser.error('BZNSYP Golden uses book-title-only protection')
        from prepare_golden import prepare
        report = prepare(args.cases, args.backend)
        print(f"BZNSYP: {report['total']} source sentences; production minimum={report['production_minimum']} unchanged")
        for threshold, counts in report['counts'].items():
            print(f"min{threshold}: {counts['mechanical']} mechanically compatible; {counts['selected']} after known-error exclusions/deduplication")
        if args.json:
            args.json.parent.mkdir(parents=True, exist_ok=True)
            args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
        return 0
    raw = subprocess.run(['node', '-e', HELPERS], input=json.dumps({'backend':str(args.backend), 'rows':rows, 'gapRule':args.gap_rule}), text=True, capture_output=True, check=True)
    report = json.loads(raw.stdout)
    failures = []
    for case in report['results']:
        case['infeasible_clauses'] = [clause['text'] for clause in case['clauses'] if not feasible(clause['lengths'], report['minimum'])]
        case['overlong_fragments'] = [fragment for clause in case['clauses'] for fragment in clause['fragments'] if fragment['visualLength'] > 13]
        case['passes'] = not case['invalid'] and not case['infeasible_clauses'] and not case['overlong_fragments']
        if not case['passes']:
            failures.append(case)
    report.update(gap_rule=args.gap_rule, total=len(rows), failed=len(failures), passed=len(rows)-len(failures), backend=str(args.backend.resolve()), maximum_final_visual_length=13, scope='Adjacent Han, normalized token gaps, original-clause word protection, recursive parent length feasibility and golden final-fragment maximum; no model inference or semantic checks')
    print(f"{len(rows)} cases: {report['passed']} passed, {len(failures)} failed; parent minimum={report['minimum']}, final maximum=13 backend visual units")
    for case in failures:
        print(f"CSV line {case['line']}: {case['text']}")
        for reason in case['invalid']:
            print('  '+reason)
        for clause in case['infeasible_clauses']:
            print('  No recursive split order obeys minimum length: '+clause)
        for fragment in case['overlong_fragments']:
            print(f"  Final fragment too long ({fragment['visualLength']} > 13): {fragment['text']}")
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(main())
