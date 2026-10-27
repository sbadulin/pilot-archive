import importlib.util
import json
import io
from datetime import date, datetime
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location('report', Path(__file__).parents[1] / 'scripts/telegram-report.py')
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


def record(uri='/', **overrides):
    result = {'ts': datetime(2026, 10, 15, 12, tzinfo=report.MOSCOW).timestamp(), 'status': 200,
              'request': {'host': 'pilot-archive.ru', 'method': 'GET', 'uri': uri,
                          'remote_ip': '192.0.2.1', 'headers': {'User-Agent': ['TestBrowser']}}}
    result.update(overrides)
    return result


class ReportTests(unittest.TestCase):
    def test_relay_receives_only_report_text(self):
        config = {'relay_url': 'https://reports.example', 'relay_key': 'test-key', 'token': 'private-token', 'chat_id': '-123'}
        with patch.object(report, 'urlopen', return_value=io.BytesIO(b'{"ok":true}')) as send:
            report.send_report(config, 'Первый Пилот: сводка')
            request = send.call_args.args[0]
            self.assertEqual(json.loads(request.data), {'text': 'Первый Пилот: сводка'})
            self.assertEqual(request.get_header('User-agent'), 'PilotArchiveReports/1.0')
            self.assertNotIn(b'private-token', request.data)

    def test_telegram_fallback_verifies_hostname_and_sends_once(self):
        transport = MagicMock()
        connection = MagicMock()
        connection.getresponse.return_value.read.return_value = b'{"ok":true,"result":{"id":1}}'
        with patch.object(report.socket, 'create_connection', side_effect=[TimeoutError(), transport]) as connect, \
             patch.object(report.ssl, 'create_default_context') as context, \
             patch.object(report, 'HTTPSConnection', return_value=connection):
            self.assertEqual(report.telegram('123:secret', 'getMe', {}), {'id': 1})
            self.assertEqual(connect.call_count, 2)
            self.assertEqual(connect.call_args.args[0], ('149.154.167.220', 443))
            context.return_value.wrap_socket.assert_called_once_with(transport, server_hostname='api.telegram.org')
            self.assertEqual(connection.request.call_count, 1)

    def test_telegram_error_never_contains_token_or_raw_api_description(self):
        connection = MagicMock()
        connection.getresponse.return_value.status = 401
        connection.getresponse.return_value.read.return_value = b'{"ok":false,"error_code":401,"description":"123:secret"}'
        with patch.object(report.socket, 'create_connection'), \
             patch.object(report.ssl, 'create_default_context'), \
             patch.object(report, 'HTTPSConnection', return_value=connection):
            with self.assertRaisesRegex(report.TelegramError, '401') as caught:
                report.telegram('123:secret', 'getMe', {})
            self.assertNotIn('123:secret', str(caught.exception))

    def test_calendar_periods(self):
        self.assertEqual(report.period('month', date(2024, 3, 1)), (date(2024, 2, 1), date(2024, 3, 1)))
        self.assertEqual(report.period('month', date(2026, 1, 1)), (date(2025, 12, 1), date(2026, 1, 1)))
        self.assertEqual(report.period('week', date(2026, 10, 19)), (date(2026, 10, 12), date(2026, 10, 19)))

    def test_unique_visitors_success_bot_and_range_filters(self):
        day = date(2026, 10, 15)
        rows = {day: report.blank_day()}
        for uri in ('/', '/?year=2000', '/archive/1.pdf', '/archive/1.pdf?download=1'):
            report.add_record(rows, record(uri))
        report.add_record(rows, record('/', status=404))
        bot = record()
        bot['request']['headers']['User-Agent'] = ['Googlebot']
        report.add_record(rows, bot)
        partial = record('/archive/1.pdf', status=206)
        partial['request']['headers']['Range'] = ['bytes=100-200']
        report.add_record(rows, partial)
        report.add_record(rows, record('/archive/manifest.json', status=304))
        report.finish_day(rows[day])
        self.assertEqual(rows[day]['views'], 2)
        self.assertEqual(rows[day]['visitors'], 1)
        self.assertEqual(rows[day]['pdf_opens'], 2)

    def test_html_only_identities_and_redirects_are_not_visitors(self):
        day = date(2026, 10, 15)
        rows = {day: report.blank_day()}
        scanner = record()
        scanner['request']['remote_ip'] = '198.51.100.7'
        report.add_record(rows, scanner)
        report.add_record(rows, record('/', status=308))
        report.add_record(rows, record('/archive/manifest.json'))
        report.finish_day(rows[day])
        self.assertEqual(rows[day]['views'], 0)
        self.assertEqual(rows[day]['visitors'], 0)
        self.assertNotIn('page_loads', rows[day])
        self.assertNotIn('manifest_readers', rows[day])

    def test_scanner_user_agents_are_bots_but_current_browsers_are_not(self):
        for agent in ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36',
                      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                      'niche-gap-finder/1.0; startup-tracker', 'Mozilla/5.0 (compatible; VertepBot/1.0)',
                      'BackupLand/1.0 (+https://backupland.com) Domain check',
                      'Hello from Palo Alto Networks, find out more about our scans', 'Mozilla/5.0 (compatible; iskalo.ru-bot)'):
            self.assertTrue(report.BOTS.search(agent), agent)
        for agent in ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
                      'Mozilla/5.0 (X11; CrOS x86_64 16328.65.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
                      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
                      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/178.0.0.0 Mobile Safari/537.36'):
            self.assertIsNone(report.BOTS.search(agent), agent)

    def test_adult_confirmations_count_distinct_identities(self):
        day = date(2026, 10, 15)
        rows = {day: report.blank_day()}
        report.add_record(rows, record('/_stats/adult', status=204))
        report.add_record(rows, record('/_stats/adult', status=204))
        report.add_record(rows, record('/_stats/adult', status=404))
        other = record('/_stats/adult', status=204)
        other['request']['remote_ip'] = '192.0.2.2'
        report.add_record(rows, other)
        self.assertEqual(len(rows[day]['adults']), 2)
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            row = report.finish_day(rows[day])
            self.assertEqual(row['adults'], 2)
            row['complete'] = True
            report.atomic_json(state / f'days/{day}.json', row)
            self.assertIn('Подтвердили 18+: 2', report.render('day', day, date(2026, 10, 16), state))

    def test_state_saved_before_adult_tracking_still_renders(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            old = {'visitors': 3, 'searchers': 1, 'views': 5, 'pdf_opens': 2, 'searches': 1, 'selections': 0,
                   'no_results': 0, 'queries': {'автор': 1}, 'authors': {}, 'empty_queries': {}, 'issues': {},
                   'complete': True, 'date': '2026-10-15'}
            report.atomic_json(state / 'days/2026-10-15.json', old)
            report.atomic_json(state / 'days/2026-10-16.json', dict(old, adults=1, date='2026-10-16'))
            message = report.render('week', date(2026, 10, 12), date(2026, 10, 19), state)
            self.assertIn('Подтвердили 18+: 1', message)
            self.assertIn('Открытия сайта: 10', message)
            self.assertIn('Посетители: 3', report.render('day', date(2026, 10, 15), date(2026, 10, 16), state))

    def test_author_events_only_count_the_local_endpoint(self):
        day = date(2026, 10, 15)
        rows = {day: report.blank_day()}
        report.add_record(rows, record('/_stats/author?event=search&q=Nobody&found=0', status=204))
        report.add_record(rows, record('/_stats/author?event=select&q=Writer', status=204))
        report.add_record(rows, record('/_stats/author?event=search&q=Wrong&found=1', status=404))
        self.assertEqual(rows[day]['searches'], 1)
        self.assertEqual(rows[day]['selections'], 1)
        self.assertEqual(rows[day]['empty_queries']['nobody'], 1)

    def test_pager_events_are_counted_and_validated(self):
        day = date(2026, 10, 15)
        rows = {day: report.blank_day()}
        for uri in ('/_stats/pager?event=open', '/_stats/pager?event=open',
                    '/_stats/pager?event=profile&nick=%D0%9A%D0%BE%D1%82',
                    '/_stats/pager?event=profile&nick=%D0%BA%D0%BE%D1%82',
                    '/_stats/pager?event=dialog&nick=Cat&with=Dog',
                    '/_stats/pager?event=search&q=ab&found=0',
                    '/_stats/pager?event=search&q=abc&found=1',
                    '/_stats/pager?event=select&q=Dog&kind=to'):
            report.add_record(rows, record(uri, status=204))
        other = record('/_stats/pager?event=open', status=204)
        other['request']['remote_ip'] = '192.0.2.2'
        report.add_record(rows, other)
        report.add_record(rows, record('/_stats/pager?event=open', status=404))
        for uri in ('/_stats/pager?event=search&q=a&found=1',
                    '/_stats/pager?event=search&q=ab',
                    '/_stats/pager?event=search&q=' + 'x' * 121 + '&found=1',
                    '/_stats/pager?event=profile&nick=%07bad',
                    '/_stats/pager?event=dialog&nick=Cat',
                    '/_stats/pager?event=select&q=Dog&kind=name',
                    '/_stats/pager?event=unknown'):
            report.add_record(rows, record(uri, status=204))
        bot = record('/_stats/pager?event=open', status=204)
        bot['request']['headers']['User-Agent'] = ['Googlebot']
        report.add_record(rows, bot)
        row = report.finish_day(rows[day])
        self.assertEqual(row['pager_openers'], 2)
        self.assertEqual(row['pager_opens'], 3)
        self.assertEqual(row['pager_profiles'], 2)
        self.assertEqual(row['pager_profile_nicks']['кот'], 2)
        self.assertEqual(row['pager_dialogs'], 1)
        self.assertEqual(row['pager_searches'], 2)
        self.assertEqual(row['pager_no_results'], 1)
        self.assertEqual(row['pager_empty_queries'], {'ab': 1})
        self.assertEqual(row['pager_selections'], 1)
        self.assertEqual(row['pager_selected'], {'dog': 1})
        self.assertEqual(row['searches'], 0)
        self.assertEqual(row['views'], 0)
        self.assertEqual(row['visitors'], 0)

    def test_pager_block_rendered_only_with_activity_and_old_state_is_compatible(self):
        day, next_day = date(2026, 10, 15), date(2026, 10, 16)
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            # A snapshot saved before the pager fields existed.
            old = {key: value for key, value in report.finish_day(report.blank_day()).items()
                   if not key.startswith('pager_')}
            old.update(visitors=1, views=3, complete=True)
            report.atomic_json(state / f'days/{day}.json', old)
            plain = report.render('day', day, next_day, state)
            self.assertIn('Открытия сайта: 3', plain)
            self.assertNotIn('Пейджер', plain)
            row = report.finish_day(report.blank_day())
            row.update(complete=True, pager_openers=1, pager_opens=2, pager_profiles=1,
                       pager_profile_nicks={'кот': 1}, pager_searches=1, pager_queries={'ёж': 1})
            report.atomic_json(state / f'days/{next_day}.json', row)
            message = report.render('day', next_day, date(2026, 10, 17), state)
            self.assertIn('Пейджер', message)
            self.assertIn('Открыли раздел: 1 посетителей, 2 раз', message)
            self.assertIn('• кот — 1', message)
            self.assertIn('• ёж — 1', message)
            week = report.render('week', date(2026, 10, 12), date(2026, 10, 19), state)
            self.assertIn('Открытия раздела: 2; посетителей в день, в среднем: 0.5', week)
            self.assertIn('Просмотры профилей: 1', week)

    def test_issue_rankings_and_zero_report_suppression(self):
        day = date(2026, 10, 15)
        rows = {day: report.blank_day()}
        report.add_record(rows, record('/archive/2000/issue-01-0066/issue.pdf'))
        self.assertEqual(rows[day]['issues']['№ 01 (0066), 2000'], 1)
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            empty = report.finish_day(report.blank_day())
            empty['complete'] = True
            report.atomic_json(state / f'days/{day}.json', empty)
            self.assertIsNone(report.render('day', day, date(2026, 10, 16), state))
            row = report.finish_day(rows[day])
            row['complete'] = True
            report.atomic_json(state / f'days/{day}.json', row)
            self.assertIn('№ 01 (0066), 2000 — 1', report.render('day', day, date(2026, 10, 16), state))

    def test_snapshot_has_no_identifiers_and_survives_expiry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            logs, state = root / 'logs', root / 'state'
            logs.mkdir()
            report.atomic_json(state / 'started.json', {'started_at': '2026-10-15T00:00:00+03:00'})
            log = logs / 'pilot-archive.log'
            log.write_text(json.dumps(record()) + '\n' + json.dumps(record('/archive/manifest.json')) + '\n')
            now = datetime(2026, 10, 16, 9, tzinfo=report.MOSCOW)
            report.collect(logs, state, now)
            snapshot = (state / 'days/2026-10-15.json').read_text()
            self.assertNotIn('192.0.2.1', snapshot)
            self.assertNotIn('TestBrowser', snapshot)
            self.assertEqual(json.loads(snapshot)['visitors'], 1)
            log.write_text('')
            report.collect(logs, state, now)
            self.assertEqual((state / 'days/2026-10-15.json').read_text(), snapshot)

    def test_partial_month_and_deduplicated_sending(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            row = report.finish_day(report.blank_day())
            row.update(visitors=2, searchers=1, views=2, complete=False)
            report.atomic_json(state / 'days/2026-10-15.json', row)
            message = report.render('month', date(2026, 10, 1), date(2026, 11, 1), state)
            self.assertIn('Неполные данные', message)
            self.assertIn('в среднем', message)
            self.assertNotIn('уникальных за месяц', message)
            config = state / 'config.json'
            report.atomic_json(config, {'token': 'test', 'chat_id': '-123'})
            now = datetime(2026, 10, 16, 9, tzinfo=report.MOSCOW)
            with patch.object(report, 'telegram', return_value={}) as send:
                report.scheduled(state, config, now)
                report.scheduled(state, config, now)
                self.assertEqual(send.call_count, 1)

    def test_uncertain_send_is_not_retried_automatically(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            row = report.finish_day(report.blank_day())
            row.update(visitors=0, searchers=0, views=1, complete=True)
            report.atomic_json(state / 'days/2026-10-15.json', row)
            config = state / 'config.json'
            report.atomic_json(config, {'token': 'test', 'chat_id': '-123'})
            now = datetime(2026, 10, 16, 9, tzinfo=report.MOSCOW)
            with patch.object(report, 'telegram', side_effect=RuntimeError('timeout')) as send:
                with self.assertRaises(RuntimeError):
                    report.scheduled(state, config, now)
                report.scheduled(state, config, now)
                self.assertEqual(send.call_count, 1)


if __name__ == '__main__':
    unittest.main()
