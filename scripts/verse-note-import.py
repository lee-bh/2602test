# Turns the downloaded verse-note pages into INSERT OR IGNORE statements for D1.
# Usage: python3 -I scripts/verse-note-import.py <dir with Firestore page*.json> > scripts/verse-note-import.sql
# Every entry goes to the account that signed up first (the site owner). Ids are
# verse-<Firestore id>, so running the SQL twice adds nothing the second time.
import json, glob, sys, re
from datetime import datetime, timezone, timedelta
pages = sys.argv[1]
OWNER = '(SELECT id FROM users ORDER BY created_at, rowid LIMIT 1)'
KST = timezone(timedelta(hours=9))
def ts(v): return datetime.fromisoformat(v.replace('Z', '+00:00'))
def q(s): return "'" + s.replace("'", "''") + "'"
docs = []
for f in sorted(glob.glob(pages + '/page*.json')): docs += json.load(open(f)).get('documents', [])
for d in sorted(docs, key=lambda d: d['fields']['createdAt']['timestampValue']):
    f = d['fields']; doc_id = d['name'].rsplit('/', 1)[1]
    assert re.fullmatch(r'[\w-]+', doc_id)
    created = ts(f['createdAt']['timestampValue'])
    updated = ts(f['updatedAt']['timestampValue']) if 'updatedAt' in f else created
    utc = lambda t: t.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    print("INSERT OR IGNORE INTO entries (id, user_id, entry_date, title, body, created_at, updated_at) VALUES ("
          + ", ".join([q('verse-' + doc_id), OWNER, q(created.astimezone(KST).strftime('%Y-%m-%d')),
                       q(f['title']['stringValue'].strip()), q(f['entry']['stringValue']), q(utc(created)), q(utc(updated))]) + ");")
