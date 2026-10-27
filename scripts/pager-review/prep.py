"""Builds candidates.json for the nick review page from pager-nicks.json and pager-public.json."""
import os
from pathlib import Path
C = str(Path(os.environ.get('PILOT_ARCHIVE_ROOT', Path.home() / 'Downloads/Reading')) / 'pilot-archive-fulltext-cache') + '/'
W = C + 'nick-review/'  # working files: candidates, hints, exported answers, the built page
os.makedirs(W, exist_ok=True)
import json, hashlib

nicks = json.load(open(C + 'pager-nicks.json'))
public = {m['id']: m for m in json.load(open(C + 'pager-public.json'))}
by_name = {}
for entry in nicks['nicks']:
    for spelling in entry.get('spellings', [entry['name']]):
        by_name.setdefault(spelling, entry)
    by_name.setdefault(entry['name'], entry)

def example(entry):
    for mid in entry.get('ids', []):
        msg = public.get(mid)
        if msg and not msg.get('hold') and msg.get('text'):
            text = ' '.join(msg['text'].split())
            return {'id': mid, 'date': msg['date'], 'number': msg['number'], 'text': text[:160] + ('…' if len(text) > 160 else '')}
    return None

groups = []
for index, cand in enumerate(nicks['profileCandidates'], 1):
    members = []
    for name in cand['names']:
        entry = by_name.get(name)
        members.append({
            'name': name,
            'messages': entry['messages'] if entry else 0,
            'first': entry.get('first') if entry else None,
            'last': entry.get('last') if entry else None,
            'cls': entry.get('class') if entry else None,
            'example': example(entry) if entry else None,
        })
    stable = hashlib.sha1('|'.join(sorted(n.lower() for n in cand['names'])).encode()).hexdigest()[:10]
    groups.append({'id': f'n-{stable}', 'reasons': cand.get('reasons', []), 'members': members})
# Content-based hints (suggestions.json, by group id), shown on the page; the owner decides.
try:
    hints = {h['id']: h for h in json.load(open(W + 'suggestions.json'))}
except FileNotFoundError:
    hints = {}
for g in groups:
    if g['id'] in hints:
        g['hint'] = hints[g['id']]
json.dump(groups, open(W + 'candidates.json', 'w'), ensure_ascii=False)
print(len(groups), 'groups,', sum(len(g['members']) for g in groups), 'names,', sum(1 for g in groups for m in g['members'] if not m['example']), 'without example')
