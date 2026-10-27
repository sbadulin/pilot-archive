"""Writes evidence.json: for every remaining candidate group, all messages of each signature
(censored public text, held messages left out) — input for the content-based review."""
import os
from pathlib import Path
C = str(Path(os.environ.get('PILOT_ARCHIVE_ROOT', Path.home() / 'Downloads/Reading')) / 'pilot-archive-fulltext-cache') + '/'
W = C + 'nick-review/'  # working files: candidates, hints, exported answers, the built page
os.makedirs(W, exist_ok=True)
import json

groups = json.load(open(W + 'candidates.json'))
nicks = json.load(open(C + 'pager-nicks.json'))
public = {m['id']: m for m in json.load(open(C + 'pager-public.json'))}
by_name = {}
for entry in nicks['nicks']:
    for spelling in entry.get('spellings', [entry['name']]):
        by_name.setdefault(spelling, entry)
out = []
for g in groups:
    members = []
    for m in g['members']:
        entry = by_name.get(m['name'])
        msgs = []
        for mid in (entry or {}).get('ids', []):
            msg = public.get(mid)
            if not msg:
                continue
            msgs.append({'id': mid, 'date': msg['date'], 'issue': f"№ {msg['number']} ({msg['serial']}) {msg['year']}",
                         'signedAs': msg.get('from'), 'to': msg.get('to', []),
                         'text': None if msg.get('hold') else ' '.join((msg.get('text') or '').split())})
        members.append({'name': m['name'], 'messages': msgs})
    out.append({'id': g['id'], 'reasons': g['reasons'], 'members': members})
json.dump(out, open(W + 'evidence.json', 'w'), ensure_ascii=False, indent=1)
print(len(out), 'groups,', sum(len(m['messages']) for g in out for m in g['members']), 'messages')
