#!/bin/sh
# Cut one PDF page into a COLS x ROWS grid of overlapping tiles at DPI.
# Usage: tiles.sh <issue.pdf> <page> <out-dir> [cols=3] [rows=3] [dpi=200]
set -eu
pdf=$1 page=$2 out=$3 cols=${4:-3} rows=${5:-3} dpi=${6:-200}
mkdir -p "$out"
size=$(pdfinfo -f "$page" -l "$page" "$pdf" | awk '/^Page.*size/ {print $4, $6; exit}')
w=$(echo "$size" | awk -v d="$dpi" '{printf "%d", $1 / 72 * d}')
h=$(echo "$size" | awk -v d="$dpi" '{printf "%d", $2 / 72 * d}')
ov=60
tw=$(( w / cols + ov )) th=$(( h / rows + ov ))
r=0
while [ $r -lt "$rows" ]; do
  c=0
  while [ $c -lt "$cols" ]; do
    x=$(( c * w / cols - (c > 0 ? ov / 2 : 0) ))
    y=$(( r * h / rows - (r > 0 ? ov / 2 : 0) ))
    pdftoppm -f "$page" -l "$page" -r "$dpi" -x "$x" -y "$y" -W "$tw" -H "$th" -jpeg -jpegopt quality=85 -singlefile "$pdf" "$out/t-$r$c"
    c=$(( c + 1 ))
  done
  r=$(( r + 1 ))
done
ls "$out"
