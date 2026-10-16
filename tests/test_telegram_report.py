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
        self.assertEqual(rows[day]['views'], 2)
        self.assertEqual(len(rows[day]['visitors']), 1)
        self.assertEqual(rows[day]['pdf_opens'], 2)

    def test_author_events_only_count_the_local_endpoint(self):
        day = date(2026, 10, 15)
        rows = {day: report.blank_day()}
        report.add_record(rows, record('/_stats/author?event=search&q=Nobody&found=0', status=204))
        report.add_record(rows, record('/_stats/author?event=select&q=Writer', status=204))
        report.add_record(rows, record('/_stats/author?event=search&q=Wrong&found=1', status=404))
        self.assertEqual(rows[day]['searches'], 1)
        self.assertEqual(rows[day]['selections'], 1)
        self.assertEqual(rows[day]['empty_queries']['nobody'], 1)

    def test_issue_rankings_and_zero_report_suppression(self):
        day = date(2026, 10, 15)
        rows = {day: report.blank_day()}
        report.add_record(rows, record('/archive/2000/issue-01-0066/issue.pdf'))
        self.assertEqual(rows[day]['issues']['№ 01 (0066), 2000'], 1)
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            empty = report.blank_day()
            empty.update(visitors=0, searchers=0, complete=True)
            report.atomic_json(state / f'days/{day}.json', empty)
            self.assertIsNone(report.render('day', day, date(2026, 10, 16), state))
            row = rows[day]
            row.update(visitors=0, searchers=0, complete=True)
            report.atomic_json(state / f'days/{day}.json', row)
            self.assertIn('№ 01 (0066), 2000 — 1', report.render('day', day, date(2026, 10, 16), state))

    def test_snapshot_has_no_identifiers_and_survives_expiry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            logs, state = root / 'logs', root / 'state'
            logs.mkdir()
            report.atomic_json(state / 'started.json', {'started_at': '2026-10-15T00:00:00+03:00'})
            log = logs / 'pilot-archive.log'
            log.write_text(json.dumps(record()) + '\n')
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
            row = report.blank_day()
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
            row = report.blank_day()
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
