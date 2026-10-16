#!/usr/bin/env python3
"""Provision Cloudflare secrets from the server's protected Telegram configuration."""
import argparse
import json
from pathlib import Path
import secrets
import shlex
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server', required=True)
    parser.add_argument('--identity', required=True)
    parser.add_argument('--chat-id', required=True)
    parser.add_argument('--relay-url', required=True)
    parser.add_argument('--wrangler', default='wrangler')
    args = parser.parse_args()
    if not args.relay_url.startswith('https://') or not args.chat_id.lstrip('-').isdigit() or not args.chat_id.startswith('-'):
        raise RuntimeError('Expected HTTPS relay and negative numeric group ID')
    ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes',
           '-o', 'IdentityAgent=none', '-i', str(Path(args.identity).expanduser()), args.server]
    # Capture credentials in process memory. Never print them, pass them as CLI
    # arguments, or save them to a local file.
    read = 'if test -f /etc/pilot-reports.pending.json; then cat /etc/pilot-reports.pending.json; else cat /etc/pilot-reports.json; fi'
    source = subprocess.run(ssh + [read], capture_output=True, text=True)
    if source.returncode:
        raise RuntimeError('Cannot read protected Telegram configuration over SSH')
    config = json.loads(source.stdout)
    config.update(chat_id=args.chat_id, relay_url=args.relay_url,
                  relay_key=config.get('relay_key') or secrets.token_urlsafe(48))
    values = {'TELEGRAM_BOT_TOKEN': config['token'], 'TELEGRAM_CHAT_ID': args.chat_id,
              'REPORTS_RELAY_KEY': config['relay_key']}
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([args.wrangler, 'secret', 'bulk', '--config', str(root / 'deploy/telegram-relay/wrangler.toml')],
                            input=json.dumps(values), capture_output=True, text=True, cwd=root)
    if result.returncode:
        raise RuntimeError('Cloudflare secret upload failed; server configuration was not changed')
    program = '''import json,pathlib,sys,os
os.umask(0o077)
c=json.load(sys.stdin)
p=pathlib.Path('/etc/pilot-reports.json')
t=p.with_suffix('.new')
t.write_text(json.dumps(c));t.chmod(0o600);t.replace(p)
pathlib.Path('/etc/pilot-reports.pending.json').unlink(missing_ok=True)
print('Telegram group and relay saved; permissions 0600')
'''
    result = subprocess.run(ssh + ['python3 -c ' + shlex.quote(program)],
                            input=json.dumps(config), capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Cloudflare secrets saved, but saving server configuration failed')
    print('Cloudflare secrets and server configuration saved. No messages sent.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
