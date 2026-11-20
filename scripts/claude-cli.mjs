// Аргументы для `claude -p` в скриптах архива.
//
// Обычный `claude -p` подгружает всё, что настроено у пользователя: MCP-серверы, плагины,
// навыки, глобальные правила. Это около 40 тыс. токенов на каждый вызов, а распознавание
// выпуска делает десятки вызовов и съедает пятичасовой лимит подписки. Скриптам нужен только
// Read (картинки полос) или вовсе ничего, поэтому всё остальное отключаем: накладные падают
// примерно до 5 тыс. токенов, промпт тот же.
//
// Модель по умолчанию — Sonnet: на полосе № 47 (2000) он прочитал те же 1208 слов из 1210,
// что и Opus (словарь совпал на 99 %), а лимит тратит заметно медленнее. Другую модель задаёт
// PILOT_CLAUDE_MODEL (например, opus для полосы, которую Sonnet прочитал плохо).

const EMPTY_MCP = JSON.stringify({ mcpServers: {} });
export const CLAUDE_MODEL = process.env.PILOT_CLAUDE_MODEL || 'sonnet';

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
