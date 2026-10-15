#!/usr/bin/env bash
# Отчёт о посетителях pilot-archive.ru по журналу Caddy. Запускать на российском сервере:
#
#   sudo bash visitor-report.sh              # сводка в терминале
#   sudo bash visitor-report.sh report.html  # подробный HTML-отчёт GoAccess (забрать через scp)
#
# Посетитель — уникальная пара «IP + браузер» за день. Боты отбрасываются; «Просмотры» —
# открытия сайта (адреса выпусков после # на сервер не приходят, поэтому выпуски считаются
# по первым запросам к их PDF). Нужен jq, для HTML-отчёта — goaccess (apt install jq goaccess).
set -euo pipefail
LOG_DIR=${LOG_DIR:-/var/log/caddy}
shopt -s nullglob
logs=("$LOG_DIR"/pilot-archive*.log*)
[[ ${#logs[@]} -gt 0 ]] || { echo "Нет журналов в $LOG_DIR: проверьте блок log в Caddyfile" >&2; exit 1; }

cat_logs() { for f in "${logs[@]}"; do case "$f" in *.gz) zcat "$f" ;; *) cat "$f" ;; esac; done; }

if [[ $# -ge 1 ]]; then
  command -v goaccess >/dev/null || { echo "Установите goaccess: apt install goaccess" >&2; exit 1; }
  cat_logs | goaccess - --log-format=CADDY --ignore-crawlers --output="$1"
  echo "Отчёт: $1"
  exit 0
fi

command -v jq >/dev/null || { echo "Установите jq: apt install jq" >&2; exit 1; }
rows=$(mktemp)
trap 'rm -f "$rows"' EXIT
cat_logs | jq -r '
  select(.request.uri == "/" or .request.uri == "/index.html")
  | select((.request.headers["User-Agent"][0] // "") | test("bot|crawl|spider|preview|curl|wget|python|monitor"; "i") | not)
  | [(.ts | floor | strftime("%Y-%m-%d")), .request.remote_ip, (.request.headers["User-Agent"][0] // "")]
  | @tsv' > "$rows"

echo "День        Посетители  Просмотры"
join <(cut -f1-3 "$rows" | sort -u | cut -f1 | uniq -c | awk '{print $2, $1}') \
     <(cut -f1 "$rows" | sort | uniq -c | awk '{print $2, $1}') |
  awk '{printf "%-12s %10d %10d\n", $1, $2, $3}'
echo "Уникальных посетителей за весь журнал: $(cut -f2,3 "$rows" | sort -u | wc -l | tr -d ' ')"

echo
echo "Открытий выпусков (первые запросы к PDF, без докачки по частям):"
cat_logs | jq -r '
  select(.request.uri | test("^/archive/.*\\.pdf$"))
  | select((.request.headers.Range[0] // "bytes=0-") | test("^bytes=0-"))
  | .request.uri' | sort | uniq -c | sort -rn | head -20
