#!/usr/bin/env bash
# Puts a new, already redacted issue in the curator queue without the browser upload, which
# fails from abroad (see docs/PUBLISHING.md). The original goes to originals/ in the private
# bucket, the public version and its cover to the pending keys, and only then a 'pending' row
# is added to D1. The curator clicks «Одобрить» in the admin: the Worker copies the file to the
# public bucket, rewrites the manifest, and the browser recognizes the authors.
#
#   bash scripts/stage-issue.sh "$HOME/Downloads/Reading/pilot-archive/ПП №33(0098)-16.08.2000.pdf"
#
# Needs: npm run censor -- "<PDF>" --apply done, SSH to the Russian server (PILOT_RELAY,
# PILOT_RELAY_KEY), the Selectel profile for aws, wrangler logged in to Cloudflare.
set -euo pipefail
original=$1
relay=${PILOT_RELAY:-root@135.106.210.25}
key=${PILOT_RELAY_KEY:-$HOME/.ssh/pilot_archive_gateway}
submitter=${PILOT_SUBMITTER:-serccu.badulin@gmail.com}
bucket=${SELECTEL_PRIVATE_BUCKET:-pilot-archive-issues-private}
root=${PILOT_ARCHIVE_ROOT:-$HOME/Downloads/Reading}
here=$(cd "$(dirname "$0")" && pwd)
aws_python=${AWS_CLI_PYTHON:-$(dirname "$(python3 -c 'import os,shutil;print(os.path.realpath(shutil.which("aws")))')")/python}
ssh_opts=(-i "$key" -o BatchMode=yes -o ServerAliveInterval=30 -o LogLevel=ERROR)

name=$(basename "$original")
[[ $name =~ №[[:space:]]*([0-9]+)[[:space:]]*\(([0-9]+)\)[[:space:]]*-[[:space:]]*([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4}) ]] ||
  { echo "Name must look like «ПП №33(0098)-16.08.2000.pdf»: $name" >&2; exit 1; }
num=$(printf %02d "$((10#${BASH_REMATCH[1]}))"); serial=$(printf %04d "$((10#${BASH_REMATCH[2]}))")
day=$((10#${BASH_REMATCH[3]})); month=$((10#${BASH_REMATCH[4]})); year=${BASH_REMATCH[5]}
months=(января февраля марта апреля мая июня июля августа сентября октября ноября декабря)
date=$(printf %04d-%02d-%02d "$year" "$month" "$day")
label="$day ${months[month-1]} $year г."
slug=issue-$num-$serial
cache=$root/pilot-archive-fulltext-cache/$year-$num-$serial
public=$(ls "$cache"/*"(публичная версия).pdf" 2>/dev/null | head -1)
[[ -n $public ]] || { echo "No public version in $cache: run npm run censor -- \"$original\" --apply" >&2; exit 1; }
[[ ! $cache/redactions.json -nt $public ]] || { echo "redactions.json is newer than the public version: run censor --apply" >&2; exit 1; }

existing=$(npx wrangler d1 execute pilot_archive --remote --json --command \
  "SELECT status FROM issue_submissions WHERE year=$year AND number='$num' AND serial='$serial'" | grep -c '"status"' || true)
[[ $existing == 0 ]] || { echo "D1 already has a submission for $year №$num($serial)" >&2; exit 1; }

# PUT through the Russian server over a presigned URL: no Selectel keys there.
put() {
  local file=$1 object=$2 type=$3 remote="/tmp/stage-${2//\//_}" url code
  scp -q "${ssh_opts[@]}" "$file" "$relay:$remote"
  url=$(AWS_CA_BUNDLE=${AWS_CA_BUNDLE:-/etc/ssl/cert.pem} AWS_PROFILE=${AWS_PROFILE:-selectel} "$aws_python" "$here/presign-put.py" "$bucket" "$object" "$type")
  code=$(ssh "${ssh_opts[@]}" "$relay" "curl -s -o /dev/null -w '%{http_code}' -T $remote -H 'Content-Type: $type' '$url'; rm -f $remote")
  [[ $code == 200 ]] || { echo "PUT $object answered $code" >&2; exit 1; }
  echo "put $object"
}

id=$(uuidgen | tr 'A-Z' 'a-z')
pages=$(pdfinfo "$public" | awk '/^Pages:/ {print $2}')
cover=$(mktemp -d)/cover
# The admin renders the cover the same way: sheet 1, 350 px wide, JPEG 82.
pdftoppm -f 1 -l 1 -scale-to-x 350 -scale-to-y -1 -singlefile -jpeg -jpegopt quality=82 "$public" "$cover"
put "$original" "originals/archive/$year/$slug/issue-$id.pdf" application/pdf
put "$public" "pending/submissions/$year/$slug/$id.pdf" application/pdf
put "$cover.jpg" "pending/submissions/$year/$slug/$id.pdf.cover.jpg" image/jpeg

now=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
npx wrangler d1 execute pilot_archive --remote --command "INSERT INTO issue_submissions
  (id, year, number, serial, date, date_label, filename, pages, storage_key, status, submitted_by, created_at, updated_at)
  VALUES ('$id', $year, '$num', '$serial', '$date', '$label', '${name//\'/\'\'}', $pages,
          'submissions/$year/$slug/$id.pdf', 'pending', '$submitter', '$now', '$now')" >/dev/null
echo "№$num($serial) от $label ждёт одобрения в админке (id $id, $pages стр.)."
