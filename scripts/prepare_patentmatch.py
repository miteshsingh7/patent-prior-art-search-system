"""
Builds the retrieval benchmark from the PatentMatch test release (HPI, Risch et al. 2020),
derived from EPO search reports.

  query     = one independent claim per EP application
  qrels     = every document the examiner cited for that application
              grade 2 = X citation (novelty-destroying), grade 1 = A citation (background)
  corpus    = every cited document in the release, represented by its cited passages

Usage: python3 scripts/prepare_patentmatch.py /tmp/pm/patentmatch_test.tsv /tmp/pm/out
"""
import csv
import hashlib
import json
import os
import re
import sys
from collections import defaultdict

csv.field_size_limit(10**9)
DEPENDENT = re.compile(
    r"\bclaims?\s+\d|\b(preceding|previous|above|foregoing|prior|aforementioned)\s+claims?\b|\bany\s+(one\s+)?(of\s+)?(the\s+)?claims?\b|^the\s+\w+(\s+\w+){0,4}\s+(of|according to|as claimed in|as defined in)\s",
    re.I,
)
MAX_PASSAGES = 10
MAX_PASSAGE_CHARS = 1200
TEST_FRACTION = 0.3
MIN_CLAIM_CHARS = 120

src, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)

app_grades = defaultdict(dict)  # app -> doc -> grade
app_claims = defaultdict(dict)  # app -> claim text -> set(docs)
app_date = {}
doc_passages = defaultdict(list)
doc_seen = defaultdict(set)

with open(src, newline="") as f:
    reader = csv.reader(f, delimiter="\t")
    next(reader)
    for row in reader:
        _, _, _cid, app, doc, text, passage, label, date = row
        grade = 2 if label == "1" else 1
        app_grades[app][doc] = max(app_grades[app].get(doc, 0), grade)
        app_date.setdefault(app, date)
        text = text.strip()
        if len(text) >= MIN_CLAIM_CHARS and not DEPENDENT.search(text):
            app_claims[app].setdefault(text, set()).add(doc)
        passage = passage.strip()
        key = hashlib.md5(passage.encode()).hexdigest()
        if passage and key not in doc_seen[doc] and len(doc_passages[doc]) < MAX_PASSAGES:
            doc_seen[doc].add(key)
            doc_passages[doc].append(passage[:MAX_PASSAGE_CHARS])

queries = []
for app, claims in app_claims.items():
    if len(app_grades[app]) < 2:
        continue
    claim = max(claims.items(), key=lambda kv: (len(kv[1]), -len(kv[0])))[0]
    bucket = int(hashlib.sha1(app.encode()).hexdigest(), 16) % 1000 / 1000
    queries.append(
        {
            "app": app,
            "claim": claim,
            "date": app_date[app],
            "split": "test" if bucket < TEST_FRACTION else "train",
            "qrels": app_grades[app],
        }
    )

docs = [{"doc": d, "passages": p} for d, p in doc_passages.items()]

with open(os.path.join(out_dir, "queries.json"), "w") as f:
    json.dump(queries, f)
with open(os.path.join(out_dir, "docs.json"), "w") as f:
    json.dump(docs, f)

stats = {
    "applications": len(app_grades),
    "queries": len(queries),
    "test_queries": sum(q["split"] == "test" for q in queries),
    "docs": len(docs),
    "passages": sum(len(d["passages"]) for d in docs),
    "avg_qrels": sum(len(q["qrels"]) for q in queries) / max(1, len(queries)),
    "avg_x_qrels": sum(sum(g == 2 for g in q["qrels"].values()) for q in queries) / max(1, len(queries)),
    "claims_with_semicolons": sum(";" in q["claim"] for q in queries),
}
with open(os.path.join(out_dir, "stats.json"), "w") as f:
    json.dump(stats, f, indent=2)
print(json.dumps(stats, indent=2))
