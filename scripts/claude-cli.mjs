// Аргументы для `claude -p` в скриптах архива.
//
// Обычный `claude -p` подгружает всё, что настроено у пользователя: MCP-серверы, плагины,
// навыки, глобальные правила. Это около 40 тыс. токенов на каждый вызов, а распознавание
// выпуска делает десятки вызовов и съедает пятичасовой лимит подписки. Скриптам нужен только
// Read (картинки полос) или вовсе ничего, поэтому всё остальное отключаем: накладные падают
// примерно до 5 тыс. токенов, промпт тот же.
//
// Модель по умолчанию — Opus. Sonnet пробовали (№ 47–52 за 2000 год): обычную полосу он читает
// не хуже, но 5 полос из 22 сократил — «[продолжение не приводится]» в перепечатке и
// «[неразборчиво]» на целом пейджере. Экономия при этом мала (около $0.13 за полосу против
// $0.13–0.19 у Opus без MCP): главное сберегают флаги ниже, а не модель. Другую модель задаёт
// PILOT_CLAUDE_MODEL.

const EMPTY_MCP = JSON.stringify({ mcpServers: {} });
export const CLAUDE_MODEL = process.env.PILOT_CLAUDE_MODEL || 'opus';

/** @param {string} prompt @param {{ read?: boolean }} [options] */
export function claudeArgs(prompt, { read = false } = {}) {
  return [
    '-p',
    prompt,
    '--model',
    CLAUDE_MODEL,
    '--tools',
    read ? 'Read' : '',
    ...(read ? ['--allowedTools', 'Read'] : []),
    '--strict-mcp-config',
    '--mcp-config',
    EMPTY_MCP,
    '--disable-slash-commands',
    '--setting-sources',
    'project',
    '--no-session-persistence',
    '--output-format',
    'json',
  ];
}
