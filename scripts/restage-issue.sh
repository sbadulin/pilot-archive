#!/usr/bin/env bash
# Replaces the public version of an issue that is already staged but not yet approved: after a
# censor decision changed once the issue was in the curator queue. The D1 row stays, the PDF and
# its cover are overwritten at the same pending keys through the Russian server, as in
# stage-issue.sh. An approved issue is replaced with publish-redacted.mjs instead.
#
#   bash scripts/restage-issue.sh "$HOME/Downloads/Reading/pilot-archive/ПП №47(0112)-22.11.2000.pdf"
#
# Needs: npm run censor -- "<PDF>" --apply done, SSH to the Russian server (PILOT_RELAY,
# PILOT_RELAY_KEY), the Selectel profile for aws, wrangler logged in to Cloudflare.
set -euo pipefail
original=$1
relay=${PILOT_RELAY:-root@135.106.210.25}
key=${PILOT_RELAY_KEY:-$HOME/.ssh/pilot_archive_gateway}
bucket=${SELECTEL_PRIVATE_BUCKET:-pilot-archive-issues-private}
root=${PILOT_ARCHIVE_ROOT:-$HOME/Downloads/Reading}
here=$(cd "$(dirname "$0")" && pwd)
aws_python=${AWS_CLI_PYTHON:-$(dirname "$(python3 -c 'import os,shutil;print(os.path.realpath(shutil.which("aws")))')")/python}
ssh_opts=(-i "$key" -o BatchMode=yes -o ServerAliveInterval=30 -o LogLevel=ERROR)

name=$(basename "$original")
[[ $name =~ №[[:space:]]*([0-9]+)[[:space:]]*\(([0-9]+)\)[[:space:]]*-[[:space:]]*([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4}) ]] ||
  { echo "Name must look like «ПП №33(0098)-16.08.2000.pdf»: $name" >&2; exit 1; }
num=$(printf %02d "$((10#${BASH_REMATCH[1]}))"); serial=$(printf %04d "$((10#${BASH_REMATCH[2]}))"); year=${BASH_REMATCH[5]}
cache=$root/pilot-archive-fulltext-cache/$year-$num-$serial
public=$(ls "$cache"/*"(публичная версия).pdf" 2>/dev/null | head -1)
[[ -n $public ]] || { echo "No public version in $cache: run npm run censor -- \"$original\" --apply" >&2; exit 1; }
[[ ! $cache/redactions.json -nt $public ]] || { echo "redactions.json is newer than the public version: run censor --apply" >&2; exit 1; }

row=$(npx wrangler d1 execute pilot_archive --remote --json --command \
  "SELECT status, storage_key FROM issue_submissions WHERE year=$year AND number='$num' AND serial='$serial'")
status=$(printf '%s' "$row" | python3 -c 'import json,sys; r=json.load(sys.stdin)[0]["results"]; print(r[0]["status"] if len(r)==1 else len(r))')
storage=$(printf '%s' "$row" | python3 -c 'import json,sys; r=json.load(sys.stdin)[0]["results"]; print(r[0]["storage_key"] if len(r)==1 else "")')
[[ $status == pending ]] || { echo "Expected one pending submission for $year №$num($serial), got: $status" >&2; exit 1; }

put() {
  local file=$1 object=$2 type=$3 remote="/tmp/restage-${2//\//_}" url code
  scp -q "${ssh_opts[@]}" "$file" "$relay:$remote"
  url=$(AWS_CA_BUNDLE=${AWS_CA_BUNDLE:-/etc/ssl/cert.pem} AWS_PROFILE=${AWS_PROFILE:-selectel} "$aws_python" "$here/presign-put.py" "$bucket" "$object" "$type")
  code=$(ssh "${ssh_opts[@]}" "$relay" "curl -s -o /dev/null -w '%{http_code}' -T $remote -H 'Content-Type: $type' '$url'; rm -f $remote")
  [[ $code == 200 ]] || { echo "PUT $object answered $code" >&2; exit 1; }
  echo "put $object"
}

cover=$(mktemp -d)/cover
pdftoppm -f 1 -l 1 -scale-to-x 350 -scale-to-y -1 -singlefile -jpeg -jpegopt quality=82 "$public" "$cover"
put "$public" "pending/$storage" application/pdf
put "$cover.jpg" "pending/$storage.cover.jpg" image/jpeg
echo "№$num($serial): the pending submission now holds the current public version ($(stat -f %z "$public") bytes)."
