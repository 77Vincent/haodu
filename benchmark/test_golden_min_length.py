import unittest
from check_golden_min_length import feasible, HELPERS
import json
import subprocess
from pathlib import Path


class MinimumLengthTests(unittest.TestCase):
    def test_recursive_order_can_keep_short_leaves(self):
        # 6|7|6: split 13|6 then 6|7, both parent ranges meet 13.
        self.assertTrue(feasible([[0,6,13,19],[0,0,7,13],[0,0,0,6],[0,0,0,0]],13))

    def test_short_children_cannot_be_split_again(self):
        # 5|7|4: total 16 is eligible, but either second parent is too short.
        self.assertFalse(feasible([[0,5,12,16],[0,0,7,11],[0,0,0,4],[0,0,0,0]],13))

    def test_real_backend_numeric_units_and_presegmentation(self):
        backend=Path(__file__).resolve().parents[1]/'src/backend/chunker.js'
        texts=['有一名男子｜在家中疑似中风｜动弹不了','有一名男子｜在家中疑似中风动弹不了','利用这种技术｜医生、护士和其他医疗专业人员','一般山脊海拔大于2000米｜切割深度大于1000米','甲'*13,'甲'*14]
        result=subprocess.run(['node','-e',HELPERS],input=json.dumps({'backend':str(backend),'rows':[{'line':i+2,'text':t} for i,t in enumerate(texts)]}),text=True,capture_output=True,check=True)
        report=json.loads(result.stdout)
        actual=[all(feasible(c['lengths'],report['minimum']) for c in r['clauses']) for r in report['results']]
        self.assertEqual(actual,[False,True,False,True,True,True])
        self.assertEqual(report['results'][3]['clauses'][0]['lengths'][0][1],10)
        too_long=lambda row: [f for c in row['clauses'] for f in c['fragments'] if f['visualLength']>13]
        self.assertEqual(too_long(report['results'][4]),[])
        self.assertEqual(too_long(report['results'][5]),[{'text':'甲'*14,'visualLength':14}])


    def test_hard_gap_rules(self):
        backend=Path(__file__).resolve().parents[1]/'src/backend/chunker.js'
        texts=['如今的《圆桌派》｜每期质量参差不齐','包括｜α辐射和其他辐射类型','我｜们需要更加认真地研究这个问题','我们｜需要更加认真地研究这个问题','这是引用“内容”｜后面的文字','前面的文字｜“这是引用的内容”']
        result=subprocess.run(['node','-e',HELPERS],input=json.dumps({'backend':str(backend),'rows':[{'line':i+2,'text':t} for i,t in enumerate(texts)]}),text=True,capture_output=True,check=True)
        rows=json.loads(result.stdout)['results']
        for i in [0,1,4,5]:
            self.assertTrue(any('adjacent source Han' in reason for reason in rows[i]['invalid']))
        self.assertTrue(any('protected word' in reason for reason in rows[2]['invalid']))
        self.assertEqual(rows[3]['invalid'],[])


if __name__=='__main__':
    unittest.main()
