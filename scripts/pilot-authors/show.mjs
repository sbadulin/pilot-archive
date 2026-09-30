// Print pilot outputs compactly: node show.mjs <file.json>...
import { readFileSync } from 'node:fs';

for (const f of process.argv.slice(2)) {
  const o = JSON.parse(readFileSync(f, 'utf8'));
  console.log(`== ${f} (${o.ms}ms, tokens ${o.usage?.prompt_tokens ?? '?'}/${o.usage?.completion_tokens ?? '?'})`);
  if (o.parseError) { console.log('PARSE ERROR:', o.raw.slice(0, 400)); continue; }
  if (o.cover) console.log('cover:', JSON.stringify(o.cover));
  for (const a of o.articles ?? []) console.log(`  «${a.title}» — ${a.byline ?? '∅'}`);
  for (const c of o.credits ?? []) console.log(`  [${c.kind}] ${c.name}`);
}
