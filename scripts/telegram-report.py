#!/usr/bin/env python3
"""Aggregate Caddy logs locally; publish only totals to Telegram. Python 3.10+."""
import argparse
from collections import Counter
from datetime import date, datetime, time, timedelta
import fcntl
import getpass
import gzip
from http.client import HTTPSConnection
import json
import os
from pathlib import Path
import re
import socket
import ssl
import sys
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

MOSCOW = ZoneInfo('Europe/Moscow')
BOTS = re.compile(r'bot|crawl|spider|preview|curl|wget|python|monitor|^node$|playwright|headlesschrome'
                  # Scanners seen in the log: pinned old Chrome builds and site checkers.
                  r'|Chrome/78\.|CrOS x86_64 14541\.0\.0|niche-gap-finder|BackupLand|Palo Alto Networks|iskalo', re.I)
PAGES = ('/', '/index.html')
MANIFEST = '/archive/manifest.json'


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    temporary.chmod(0o600)
    temporary.replace(path)


def read_json(path, default=None):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default


def dates(start, end):
    while start < end:
        yield start
        start += timedelta(days=1)


def period(kind, today):
    if kind == 'day':
        return today - timedelta(days=1), today
    if kind == 'week':
        end = today - timedelta(days=today.weekday())
        return end - timedelta(days=7), end
    end = today.replace(day=1)
    return (end - timedelta(days=1)).replace(day=1), end


def blank_day():
    # page_loads and manifest_readers hold (IP, User-Agent) in memory only; finish_day() drops them.
    return dict(visitors=set(), searchers=set(), adults=set(), views=0, pdf_opens=0,
                searches=0, selections=0, no_results=0, page_loads=Counter(), manifest_readers=set(),
                queries=Counter(), authors=Counter(), empty_queries=Counter(), issues=Counter(),
                **blank_pager())


# Pager fields are optional in saved days: snapshots written before the section existed lack them.
PAGER_COUNTS = ('pager_openers', 'pager_opens', 'pager_profiles', 'pager_dialogs',
                'pager_searches', 'pager_no_results', 'pager_selections')
PAGER_TOPS = ('pager_profile_nicks', 'pager_queries', 'pager_empty_queries', 'pager_selected')


def blank_pager():
    row = {key: 0 for key in PAGER_COUNTS}
    row.update({key: Counter() for key in PAGER_TOPS})
    # (IP, User-Agent) in memory only; finish_day() turns it into a count.
    row['pager_openers'] = set()
    return row


def event_text(params, name, minimum=1):
    # Same limits as author queries: collapsed whitespace, lower case, 120 chars, no control characters.
    value = ' '.join(params.get(name, [''])[0].split()).lower()
    if not minimum <= len(value) <= 120 or any(ord(char) < 32 or ord(char) == 127 for char in value):
        return None
    return value


def add_pager_event(row, identity, query):
    params = parse_qs(query, max_num_fields=10)
    event = params.get('event', [''])[0]
    if event == 'open':
        row['pager_opens'] += 1
        row['pager_openers'].add(identity)
    elif event == 'profile':
        nick = event_text(params, 'nick')
        if nick:
            row['pager_profiles'] += 1
            row['pager_profile_nicks'][nick] += 1
    elif event == 'dialog':
        if event_text(params, 'nick') and event_text(params, 'with'):
            row['pager_dialogs'] += 1
    elif event == 'search':
        text = event_text(params, 'q', 2)
        found = params.get('found', [''])[0]
        if text and found in ('0', '1'):
            row['pager_searches'] += 1
            row['pager_queries'][text] += 1
            if found == '0':
                row['pager_no_results'] += 1
                row['pager_empty_queries'][text] += 1
    elif event == 'select':
        text = event_text(params, 'q')
        if text and params.get('kind', [''])[0] in ('author', 'to'):
            row['pager_selections'] += 1
            row['pager_selected'][text] += 1


def finish_day(row):
    """Turn a day's in-memory identities into the saved counts, with no IP or User-Agent.

    A page load counts only if the same IP + browser also fetched the manifest that day.
    The app always revalidates it (Cache-Control: no-cache), so a real visit logs it as
    200 or 304. Scanners that fetch only the HTML never do."""
    page_loads, readers = row.pop('page_loads'), row.pop('manifest_readers')
    for identity, count in page_loads.items():
        if identity in readers:
            row['visitors'].add(identity)
            row['views'] += count
    for key in ('visitors', 'searchers', 'adults', 'pager_openers'):
        row[key] = len(row[key])
    return row


def add_record(days, record):
    request = record.get('request', {})
    if request.get('host', '').split(':')[0] != 'pilot-archive.ru':
        return
    status = record.get('status', 0)
    if request.get('method') != 'GET' or not (200 <= status < 400):
        return
    headers = {key.lower(): value for key, value in request.get('headers', {}).items()}
    agent = (headers.get('user-agent') or [''])[0]
    if not agent or BOTS.search(agent):
        return
    day = datetime.fromtimestamp(record['ts'], MOSCOW).date()
    if day not in days:
        return
    row = days[day]
    identity = (request.get('remote_ip', ''), agent)
    url = urlsplit(request.get('uri', ''))
    # Redirects (e.g. 308 http→https) are not views: only 2xx and 304 count.
    loaded = status < 300 or status == 304
    if url.path in PAGES:
        if loaded:
            row['page_loads'][identity] += 1
    elif url.path == MANIFEST:
        if loaded:
            row['manifest_readers'].add(identity)
    elif url.path == '/_stats/adult' and status == 204:
        row['adults'].add(identity)
    elif url.path.startswith('/archive/') and url.path.lower().endswith('.pdf'):
        if re.match(r'^bytes=0-', (headers.get('range') or ['bytes=0-'])[0]):
            row['pdf_opens'] += 1
            issue = re.match(r'^/archive/(\d{4})/issue-(\d+)-(\d+)(?:/|$)', url.path)
            if issue:
                year, number, serial = issue.groups()
                row['issues'][f'№ {number} ({serial}), {year}'] += 1
            else:
                row['issues']['Другие выпуски'] += 1
    elif url.path == '/_stats/author' and record.get('status') == 204:
        params = parse_qs(url.query, max_num_fields=10)
        event = params.get('event', [''])[0]
        query = ' '.join(params.get('q', [''])[0].split()).lower()
        minimum = 1 if event == 'select' else 2
        if not minimum <= len(query) <= 120 or any(ord(char) < 32 for char in query):
            return
        if event == 'search' and params.get('found', [''])[0] in ('0', '1'):
            row['searches'] += 1
            row['searchers'].add(identity)
            row['queries'][query] += 1
            if params['found'][0] == '0':
                row['no_results'] += 1
                row['empty_queries'][query] += 1
        elif event == 'select':
            row['selections'] += 1
            row['authors'][query] += 1
    elif url.path == '/_stats/pager' and status == 204:
        # Counted like author and 18+ events: any non-bot identity whose beacon Caddy answered.
        add_pager_event(row, identity, url.query)


def collect(log_dir, state_dir, now):
    meta_path = state_dir / 'started.json'
    meta = read_json(meta_path)
    if meta is None:
        raise RuntimeError('Сначала выполните init при включении журнала.')
    started = datetime.fromisoformat(meta['started_at']).astimezone(MOSCOW)
    # A complete day is saved once. Aggregates survive log expiry and contain no IDs.
    first = max(started.date(), now.date() - timedelta(days=28))
    pending = {day: blank_day() for day in dates(first, now.date())
               if not (state_dir / 'days' / f'{day}.json').exists()}
    if not pending:
        return
    logs = sorted(log_dir.glob('pilot-archive*.log*'))
    if not logs:
        raise RuntimeError('Журнал Caddy не найден; пустые дни не будут сохранены.')
    malformed = 0
    for path in logs:
        opener = gzip.open if path.suffix == '.gz' else open
        with opener(path, 'rt', encoding='utf-8') as source:
            for line in source:
                try:
                    add_record(pending, json.loads(line))
                except (ValueError, TypeError, KeyError, OverflowError, AttributeError):
                    malformed += 1
    for day, row in pending.items():
        finish_day(row)
        row['complete'] = started <= datetime.combine(day, time.min, MOSCOW)
        row['date'] = str(day)
        atomic_json(state_dir / 'days' / f'{day}.json', row)
    if malformed:
        print(f'Пропущено повреждённых записей: {malformed}', file=sys.stderr)


def top_lines(title, values):
    if not values:
        return []
    # Plain text only: input cannot introduce Telegram HTML or Markdown markup.
    return ['', title] + [f'• {name[:80]} — {count}' for name, count in values.most_common(5)]


def pager_active(rows):
    return any(row.get(key) for row in rows for key in PAGER_COUNTS)


def pager_lines(kind, rows):
    # Rendered only when the period has pager activity, so earlier reports stay unchanged.
    if not pager_active(rows):
        return []
    total = lambda key: sum(row.get(key, 0) for row in rows)
    if kind == 'day':
        opened = f'Открыли раздел: {total("pager_openers")} посетителей, {total("pager_opens")} раз'
    else:
        opened = (f'Открытия раздела: {total("pager_opens")}; посетителей в день, '
                  f'в среднем: {total("pager_openers") / len(rows):.1f}')
    lines = ['', 'Пейджер', opened,
             f'Просмотры профилей: {total("pager_profiles")}',
             f'Просмотры диалогов: {total("pager_dialogs")}',
             f'Поиск по никам: {total("pager_searches")}',
             f'Поиски без результата: {total("pager_no_results")}',
             f'Выбор ника или адресата: {total("pager_selections")}']
    for key, title in [('pager_profile_nicks', 'Чаще смотрели профили:'), ('pager_selected', 'Чаще выбирали:'),
                       ('pager_queries', 'Чаще искали в Пейджере:'),
                       ('pager_empty_queries', 'Не нашли в Пейджере:')]:
        counter = Counter()
        for row in rows:
            counter.update(row.get(key, {}))
        lines.extend(top_lines(title, counter))
    return lines


def render(kind, start, end, state_dir):
    rows = [read_json(state_dir / 'days' / f'{day}.json') for day in dates(start, end)]
    known = [row for row in rows if row is not None]
    if not known:
        return None
    # Days saved before the 18+ beacon have no 'adults' key: read every count with a default.
    total = lambda key: sum(row.get(key, 0) for row in known)
    if not any(total(key) for key in ('views', 'pdf_opens', 'searches', 'selections', 'adults')) \
            and not pager_active(known):
        return None
    label = {'day': 'за день', 'week': 'за неделю', 'month': 'за месяц'}[kind]
    span = start.strftime('%d.%m.%Y') if kind == 'day' else f'{start:%d.%m.%Y} — {end - timedelta(days=1):%d.%m.%Y}'
    lines = [f'Первый Пилот: {label}', span + ' · МСК']
    complete = sum(row['complete'] for row in known)
    if complete != len(rows):
        lines += [f'Неполные данные: полных дней {complete} из {len(rows)}.']
    if kind == 'day':
        lines += [f'Посетители: {total("visitors")}', f'Пользовались поиском: {total("searchers")}']
    else:
        lines += [f'Посетителей в день, в среднем по дням с данными: {total("visitors") / len(known):.1f}',
                  f'Максимум посетителей за день: {max(row["visitors"] for row in known)}']
    # The browser remembers the confirmation, so a reader confirms once: daily counts add up.
    lines += [f'Подтвердили 18+: {total("adults")}',
              f'Открытия сайта: {total("views")}',
              f'Загрузки выпусков: {total("pdf_opens")}',
              f'Поисковые запросы: {total("searches")}',
              f'Выбор автора: {total("selections")}',
              f'Поиски без результата: {total("no_results")}']
    for key, title in [('issues', 'Чаще открывали выпуски:'), ('authors', 'Чаще выбирали авторов:'), ('queries', 'Чаще искали:'),
                       ('empty_queries', 'Не нашли по запросам:')]:
        counter = Counter()
        for row in known:
            counter.update(row.get(key, {}))
        lines.extend(top_lines(title, counter))
    lines.extend(pager_lines(kind, known))
    lines += ['', 'Посетитель ≈ IP + браузер за день, загрузивший каталог архива. Известные боты исключены.',
              'Загрузки PDF приблизительны: кеш и повторные запросы влияют на число.']
    tracking = read_json(state_dir / 'author-tracking.json')
    if tracking is None:
        lines += ['Учёт поиска авторов ещё не включён на сайте.']
    elif datetime.fromisoformat(tracking['started_at']).date() >= start:
        stamp = datetime.fromisoformat(tracking['started_at']).astimezone(MOSCOW)
        lines += [f'Учёт поиска авторов с {stamp:%d.%m.%Y %H:%M} МСК.']
    return '\n'.join(lines)


class TelegramError(RuntimeError):
    pass


def telegram(token, method, fields):
    payload = urlencode(fields).encode()
    connection = None
    transport = None
    stage = 'TCP-соединение'
    try:
        try:
            transport = socket.create_connection(('api.telegram.org', 443), timeout=4)
        except OSError:
            # The DNS-selected Telegram address is unreachable from this Selectel
            # server. Fallback only BEFORE sending anything, so a POST is never retried.
            transport = socket.create_connection(('149.154.167.220', 443), timeout=8)
        transport.settimeout(15)
        stage = 'TLS-соединение'
        connection = HTTPSConnection('api.telegram.org', timeout=15)
        connection.sock = ssl.create_default_context().wrap_socket(transport, server_hostname='api.telegram.org')
        stage = 'ответ API'
        connection.request('POST', f'/bot{token}/{method}', body=payload,
                           headers={'Content-Type': 'application/x-www-form-urlencoded'})
        response = connection.getresponse()
        result = json.loads(response.read(1024 * 1024))
        if not result.get('ok'):
            code = result.get('error_code', response.status)
            hint = ' Проверьте, что скопирован весь токен именно этого бота.' if code in (401, 404) else ''
            raise TelegramError(f'Telegram отклонил запрос: HTTP {response.status}, код {code}.{hint}')
        return result['result']
    except TelegramError:
        raise
    except Exception as error:
        # Never print an exception's message: it can include the URL and token.
        raise TelegramError(f'Telegram: {stage}, ошибка {type(error).__name__}. Токен скрыт.') from None
    finally:
        if connection:
            connection.close()
        if transport:
            transport.close()


def configure(config_path):
    pending_path = config_path.with_suffix('.pending.json')
    previous = read_json(pending_path, read_json(config_path, {}))
    prompt = 'Токен из BotFather (ввод скрыт; Enter — сохранённый): ' if previous else 'Токен из BotFather (ввод скрыт): '
    token = getpass.getpass(prompt).strip() or previous.get('token', '')
    if not re.fullmatch(r'\d+:[A-Za-z0-9_-]+', token):
        raise RuntimeError('Неверный формат токена.')
    atomic_json(pending_path, {'token': token})
    print('Проверяю токен через Telegram, обычно до 15 секунд…', flush=True)
    bot = telegram(token, 'getMe', {})
    print(f'Бот: @{bot["username"]}')
    # Only inspect chat metadata; never print or persist group messages.
    updates = telegram(token, 'getUpdates', {'timeout': 0})
    chats = {}
    for update in updates:
        chat = (update.get('message') or update.get('my_chat_member') or {}).get('chat', {})
        if chat.get('type') in ('group', 'supergroup'):
            chats[str(chat['id'])] = chat.get('title', '(без названия)')
    for chat_id, title in chats.items():
        print(f'{chat_id}: {title}')
    chat_id = input('Числовой ID нужной группы из списка: ').strip()
    if not re.fullmatch(r'-[0-9]+', chat_id):
        raise RuntimeError('Нужен числовой ID группы, включая минус.')
    chat = telegram(token, 'getChat', {'chat_id': chat_id})
    if chat.get('type') not in ('group', 'supergroup', 'channel'):
        raise RuntimeError('Этот чат не является группой или каналом.')
    atomic_json(config_path, {'token': token, 'chat_id': chat_id})
    pending_path.unlink(missing_ok=True)
    print('Настройки сохранены. Сообщения при настройке не отправляются.')


def send_report(config, message):
    if config.get('relay_url'):
        url = config['relay_url'].rstrip('/') + '/send'
        if not url.startswith('https://'):
            raise RuntimeError('Для relay требуется HTTPS.')
        request = Request(url, data=json.dumps({'text': message}, ensure_ascii=False).encode(), headers={
            'Content-Type': 'application/json', 'Authorization': f'Bearer {config["relay_key"]}',
            'User-Agent': 'PilotArchiveReports/1.0',
        })
        try:
            with urlopen(request, timeout=25) as response:
                if not json.load(response).get('ok'):
                    raise ValueError('Relay rejected report')
        except Exception:
            raise RuntimeError('Relay не подтвердил доставку. Проверьте группу перед повтором.') from None
    else:
        telegram(config['token'], 'sendMessage', {
            'chat_id': config['chat_id'], 'text': message, 'disable_web_page_preview': 'true',
        })


def scheduled(state_dir, config_path, now):
    if now.hour < 9 or not config_path.exists():
        return
    config = read_json(config_path)
    ledger_path = state_dir / 'deliveries.json'
    ledger = read_json(ledger_path, {})
    for kind in ('day', 'week', 'month'):
        start, end = period(kind, now.date())
        key = f'{kind}:{start}:{end}'
        if key in ledger:
            continue
        message = render(kind, start, end, state_dir)
        if message is None:
            continue
        # Record before sending: an ambiguous timeout must not spam the group on retry.
        ledger[key] = 'sending'
        atomic_json(ledger_path, ledger)
        try:
            send_report(config, message)
        except RuntimeError:
            ledger[key] = 'uncertain; check group before manually retrying'
            atomic_json(ledger_path, ledger)
            raise
        ledger[key] = 'sent'
        atomic_json(ledger_path, ledger)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init', 'collect', 'report', 'scheduled', 'configure', 'enable-author-tracking'])
    parser.add_argument('--period', choices=['day', 'week', 'month'], default='day')
    parser.add_argument('--date', type=date.fromisoformat, help='Reference date, defaults to today in Moscow')
    parser.add_argument('--log-dir', type=Path, default=Path('/var/log/caddy'))
    parser.add_argument('--state-dir', type=Path, default=Path('/var/lib/pilot-reports'))
    parser.add_argument('--config', type=Path, default=Path('/etc/pilot-reports.json'))
    args = parser.parse_args()
    os.umask(0o077)
    now = datetime.now(MOSCOW)
    if args.command == 'configure':
        configure(args.config)
        return
    args.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (args.state_dir / '.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command in ('init', 'enable-author-tracking'):
            name = 'started.json' if args.command == 'init' else 'author-tracking.json'
            path = args.state_dir / name
            if not path.exists():
                atomic_json(path, {'started_at': now.isoformat()})
        elif args.command == 'report':
            start, end = period(args.period, args.date or now.date())
            print(render(args.period, start, end, args.state_dir) or 'Нет данных за этот период.')
        else:
            collect(args.log_dir, args.state_dir, now)
            if args.command == 'scheduled':
                scheduled(args.state_dir, args.config, now)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('\nНастройка прервана.', file=sys.stderr)
        sys.exit(130)
