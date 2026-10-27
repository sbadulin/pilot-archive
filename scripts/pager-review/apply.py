"""Applies review-page decisions to scripts/pager-nick-aliases.json, oldest first (a later answer wins).

merge    → members other than the main nick become its aliases; names left unticked in the group
           are recorded as different from the main nick.
distinct → the group's names are recorded as different people.
unsure   → nothing.
Joint signatures (rules.joint) are never aliased. Re-running is safe: nothing is added twice.
"""
import os
from pathlib import Path
C = str(Path(os.environ.get('PILOT_ARCHIVE_ROOT', Path.home() / 'Downloads/Reading')) / 'pilot-archive-fulltext-cache') + '/'
W = C + 'nick-review/'  # working files: candidates, hints, exported answers, the built page
os.makedirs(W, exist_ok=True)
import glob, json, sys

DECISIONS = W + 'decisions/*.json'
rules_path = sys.argv[1]
rules = json.load(open(rules_path))
joint = {k.lower() for k in rules.get('joint', {})}
aliases = rules.setdefault('aliases', {})
distinct = rules.setdefault('distinct', [])
low = lambda names: {n.lower() for n in names}
added = []

def add_distinct(group):
    group = [n for n in dict.fromkeys(group) if n.lower() not in joint]
    if len(group) < 2 or any(low(group) <= low(existing) for existing in distinct):
        return
    distinct.append(group)
    added.append('разные: ' + ', '.join(group))

def drop_from_distinct(names):
    gone = low(names)
    for existing in distinct:
        existing[:] = [n for n in existing if n.lower() not in gone]
    distinct[:] = [g for g in distinct if len(g) >= 2]

docs = [json.load(open(p)) for p in glob.glob(DECISIONS)]
docs = sorted((d.get('data', d) for d in docs), key=lambda d: d.get('decidedAt', ''))
for d in docs:
    names = d.get('names', [])
    if d.get('verdict') == 'merge':
        main = d['main']
        members = [n for n in d['members'] if n.lower() not in joint]
        drop_from_distinct([n for n in members if n != main])
        for name in members:
            if name != main and aliases.get(name) != main:
                aliases[name] = main
                added.append(f'{name} → {main}')
        add_distinct([main] + [n for n in names if n not in d['members']])
    elif d.get('verdict') == 'distinct':
        for name in names:
            if aliases.get(name) in names:
                del aliases[name]
                added.append(f'снята склейка {name}')
        add_distinct(names)
json.dump(rules, open(rules_path, 'w'), ensure_ascii=False, indent=2)
open(rules_path, 'a').write('\n')
print('\n'.join(added) or 'nothing new')
