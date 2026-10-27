// PROTOTYPE — throwaway. Three variants of the «Pageer» section, switchable via ?variant=A|B|C
// and the floating bar at the bottom (← → keys). Data: hand-picked sample (pageerSample.ts).
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CornerDownRight, FileText, MessageSquare, MessagesSquare, AtSign } from 'lucide-react';
import { byNick, dateLabel, issueLabel, mentions, messages, nickOf, profiles, type PagerMessage } from './pageerSample';

const VARIANTS = [
  { key: 'A', name: 'Лента' },
  { key: 'B', name: 'Полоса газеты' },
  { key: 'C', name: 'Профили и диалоги' },
] as const;
type VariantKey = (typeof VARIANTS)[number]['key'];

const byId = new Map(messages.map((msg) => [msg.id, msg]));
const sorted = [...messages].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
const pageHref = (msg: { issue: string; sheet: number }) => `#issue-${msg.issue}-p${msg.sheet}`;

// Profile and tab live in the address (#pageer/BAD/dialogs), so the browser's Back works and links can be shared.
type Tab = 'own' | 'about' | 'articles' | 'dialogs';
const TABS: Tab[] = ['own', 'about', 'articles', 'dialogs'];
function readRoute() {
  const [, nick, tab, withNick] = window.location.hash.replace(/^#/, '').split('/').map(decodeURIComponent);
  return { nick: nick || null, tab: (TABS.includes(tab as Tab) ? tab : 'own') as Tab, with: withNick || null };
}
function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
const profileHash = (nick: string, tab: Tab = 'own', withNick?: string) =>
  `#pageer/${encodeURIComponent(nick)}${tab === 'own' && !withNick ? '' : `/${tab}`}${withNick ? `/${encodeURIComponent(withNick)}` : ''}`;
const openProfile = (nick: string, tab: Tab = 'own') => { window.location.hash = profileHash(nick, tab); };
const closeProfile = () => { window.location.hash = 'pageer'; };

// The nick's exchanges grouped by counterpart: its messages to X and X's messages to or about it.
function threadsOf(nick: string, aliases: string[]) {
  const threads = new Map<string, PagerMessage[]>();
  for (const msg of [...byNick(nick), ...mentions(nick, aliases)].sort((a, b) => a.date.localeCompare(b.date))) {
    const other = msg.nick === nick ? (nickOf(msg.to[0] ?? '') ?? msg.to[0] ?? 'всем') : (msg.nick ?? msg.from);
    threads.set(other, [...(threads.get(other) ?? []), msg]);
  }
  return threads;
}

function Dialogs({ nick, aliases, onOpen, only }: { nick: string; aliases: string[]; onOpen: (nick: string) => void; only?: string | null }) {
  const all = threadsOf(nick, aliases);
  const threads = only ? [...all].filter(([other]) => other.toLowerCase() === only.toLowerCase()) : [...all];
  if (!all.size) return <p className="pg-muted">Переписки пока нет.</p>;
  return (
    <div className="pg-dialogs">
      {only && <a className="pg-back" href={profileHash(nick, 'dialogs')}><ArrowLeft size={16} /> Все диалоги {nick}</a>}
      {!threads.length && <p className="pg-muted">Диалога с {only} нет.</p>}
      {threads.map(([other, list]) => (
        <div key={other} className="pg-thread-box">
          <h3>
            {nick} <span className="pg-muted">и</span> <Name name={other} onOpen={onOpen} />
            {!only && <a className="pg-permalink" href={profileHash(nick, 'dialogs', other)} title="Ссылка на этот диалог">#</a>}
          </h3>
          {list.map((msg) => (
            <div key={msg.id} className={`pg-bubble ${msg.nick === nick ? 'mine' : ''}`}>
              <span className="pg-muted">{msg.from} · {dateLabel(msg.date)} · <a href={pageHref(msg)}>{issueLabel(msg.issue)}</a></span>
              <p>{msg.text}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// A name that has a profile becomes a link; any other name stays plain text (no aggregation of real names).
function Name({ name, onOpen, strong = true }: { name: string; onOpen: (nick: string) => void; strong?: boolean }) {
  const nick = nickOf(name);
  const label = strong ? <b>{name}</b> : <span>{name}</span>;
  return nick ? <button className="pg-name" onClick={() => onOpen(nick)}>{label}</button> : label;
}

function Avatar({ name }: { name: string }) {
  const letters = name.replace(/[^\p{L}\p{N}@]/gu, '').slice(0, 2).toUpperCase() || '?';
  return <span className="pg-avatar" aria-hidden>{letters}</span>;
}

function Profile({ nick, onOpen, onClose, compact = false, tab: routeTab, onTab, withNick }: { nick: string; onOpen: (nick: string) => void; onClose?: () => void; compact?: boolean; tab?: Tab; onTab?: (tab: Tab) => void; withNick?: string | null }) {
  const profile = profiles[nick] ?? { nick, aliases: [], articles: [] };
  const own = byNick(nick);
  const about = mentions(nick, profile.aliases);
  const [localTab, setLocalTab] = useState<Tab>('own');
  const tab = routeTab ?? localTab;
  const setTab = onTab ?? setLocalTab;
  const list = tab === 'own' ? own : about;
  const dates = own.map((msg) => msg.date).sort();
  return (
    <section className={`pg-profile${compact ? ' compact' : ''}`}>
      {onClose && <button className="pg-back" onClick={onClose}><ArrowLeft size={16} /> К ленте</button>}
      <span className="black-label">Профиль</span>
      <h2>{nick}</h2>
      {profile.aliases.length > 0 && <p className="pg-muted">Также подписывался: {profile.aliases.join(', ')}</p>}
      {profile.about && <p>{profile.about}</p>}
      <div className="pg-stats">
        <span><b>{own.length}</b> сообщений</span>
        <span><b>{about.length}</b> упоминаний</span>
        <span><b>{profile.articles.length}</b> материалов</span>
        {dates.length > 0 && <span>{dates[0] === dates.at(-1) ? dateLabel(dates[0]) : `${dateLabel(dates[0])} — ${dateLabel(dates.at(-1)!)}`}</span>}
      </div>
      <div className="pg-tabs" role="tablist">
        <button className={tab === 'own' ? 'on' : ''} onClick={() => setTab('own')}><MessageSquare size={15} /> Сообщения</button>
        <button className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')}><AtSign size={15} /> Упоминания</button>
        <button className={tab === 'articles' ? 'on' : ''} onClick={() => setTab('articles')}><FileText size={15} /> В газете</button>
        <button className={tab === 'dialogs' ? 'on' : ''} onClick={() => setTab('dialogs')}><MessagesSquare size={15} /> Диалоги</button>
      </div>
      {tab === 'dialogs' ? (
        <Dialogs nick={nick} aliases={profile.aliases} onOpen={onOpen} only={withNick} />
      ) : tab === 'articles' ? (
        <ul className="pg-articles">
          {profile.articles.map((article) => (
            <li key={article.issue + article.page + article.title}>
              <a href={`#issue-${article.issue}-p${article.page}`}>
                <span className="pg-muted">{issueLabel(article.issue)} · стр. {article.page} · {article.kind === 'letter' ? 'письмо' : 'статья'}</span>
                <b>{article.title}</b>
              </a>
            </li>
          ))}
          {!profile.articles.length && <li className="pg-muted">Подписанных материалов нет.</li>}
        </ul>
      ) : (
        <div className="pg-feed">
          {list.map((msg) => <Post key={msg.id} msg={msg} onOpen={onOpen} />)}
          {!list.length && <p className="pg-muted">Пока пусто.</p>}
        </div>
      )}
    </section>
  );
}

function Post({ msg, onOpen }: { msg: PagerMessage; onOpen: (nick: string) => void }) {
  const parent = msg.replyTo ? byId.get(msg.replyTo) : undefined;
  return (
    <article className="pg-post">
      <Avatar name={msg.from} />
      <div>
        <header>
          <Name name={msg.from} onOpen={onOpen} />
          {msg.to.length > 0 && <span className="pg-to">→ {msg.to.map((t, i) => <span key={t}>{i ? ', ' : ''}<Name name={t} onOpen={onOpen} strong={false} /></span>)}</span>}
        </header>
        {parent && (
          <p className="pg-parent"><CornerDownRight size={14} /> в ответ <Name name={parent.from} onOpen={onOpen} strong={false} />: «{parent.text.slice(0, 80)}…»</p>
        )}
        <p className="pg-text">{msg.text}{msg.retold && <em className="pg-retold"> пересказ, текст будет перераспознан</em>}</p>
        <footer><a href={pageHref(msg)}>{dateLabel(msg.date)} · {issueLabel(msg.issue)} · стр. {msg.sheet}</a></footer>
      </div>
    </article>
  );
}

// A — a single-column timeline, oldest first, with a year rail on the left.
function VariantA() {
  const { nick, tab, with: withNick } = useRoute();
  const setNick = (next: string) => openProfile(next);
  if (nick) return <div className="pg-a"><aside className="pg-rail"><Intro /></aside><Profile nick={nick} onOpen={setNick} onClose={closeProfile} tab={tab} onTab={(next) => openProfile(nick, next)} withNick={withNick} /></div>;
  const months = new Map<string, PagerMessage[]>();
  for (const msg of sorted) months.set(msg.date.slice(0, 7), [...(months.get(msg.date.slice(0, 7)) ?? []), msg]);
  return (
    <div className="pg-a">
      <aside className="pg-rail">
        <Intro />
        <nav className="pg-months">
          {[...months.keys()].map((month) => <a key={month} href={`#m-${month}`}>{new Date(`${month}-15`).toLocaleDateString('ru-RU', { month: 'long' })}</a>)}
        </nav>
        <a className="pg-cta" href="#pageer/BAD">Профиль BAD →</a>
      </aside>
      <div className="pg-feed">
        {[...months].map(([month, list]) => (
          <section key={month} id={`m-${month}`}>
            <h3 className="pg-month">{new Date(`${month}-15`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</h3>
            {list.map((msg) => <Post key={msg.id} msg={msg} onOpen={setNick} />)}
          </section>
        ))}
      </div>
    </div>
  );
}

function Intro() {
  return (
    <div className="pg-intro">
      <span className="black-label">Pageer</span>
      <h2>Пейджер</h2>
      <p>Приветы, ответы и перебранки читателей «Пилота» — от первых номеров к последним. Ник с профилем — кликабельный.</p>
    </div>
  );
}

// B — the rubric as it was printed: one newspaper strip per issue, dense columns, signature at the end.
function VariantB() {
  const [nick, setNick] = useState<string | null>(null);
  const issues = new Map<string, PagerMessage[]>();
  for (const msg of sorted) issues.set(msg.issue, [...(issues.get(msg.issue) ?? []), msg]);
  return (
    <div className="pg-b">
      <div className="pg-b-mast">
        <span className="pg-b-title">ПЕЙДЖЕР</span>
        <span>Все сообщения рубрики, номер за номером. Нажмите на подпись — откроется профиль.</span>
      </div>
      {[...issues].map(([issue, list]) => (
        <section key={issue} className="pg-strip">
          <header>
            <span className="black-label">{issueLabel(issue)}</span>
            <span>{dateLabel(list[0].date)}</span>
            <a href={pageHref(list[0])}>Открыть полосу →</a>
          </header>
          <div className="pg-columns">
            {list.map((msg) => (
              <p key={msg.id} className={msg.replyTo ? 'reply' : ''}>
                ● {msg.text} {msg.from && <Name name={msg.from} onOpen={setNick} />}
                {msg.replyTo && <span className="pg-thread"> ↩ {byId.get(msg.replyTo)?.from}</span>}
              </p>
            ))}
          </div>
        </section>
      ))}
      {nick && (
        <div className="pg-drawer" role="dialog" aria-label={`Профиль ${nick}`}>
          <Profile nick={nick} onOpen={setNick} onClose={() => setNick(null)} compact />
        </div>
      )}
    </div>
  );
}

// C — people first: an index of unique nicks; a profile shows conversations as threads.
function VariantC() {
  const nicks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const msg of messages) if (msg.nick) counts.set(msg.nick, (counts.get(msg.nick) ?? 0) + 1);
    for (const nick of Object.keys(profiles)) if (!counts.has(nick)) counts.set(nick, 0);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  }, []);
  const [nick, setNick] = useState('BAD');
  const profile = profiles[nick] ?? { nick, aliases: [], articles: [] };
  const own = byNick(nick);
  const about = mentions(nick, profile.aliases);
  // Group the nick's exchanges by counterpart: its messages to X and X's messages to it.
  const threads = new Map<string, PagerMessage[]>();
  for (const msg of [...own, ...about].sort((a, b) => a.date.localeCompare(b.date))) {
    const other = msg.nick === nick ? (nickOf(msg.to[0] ?? '') ?? msg.to[0] ?? 'всем') : (msg.nick ?? msg.from);
    threads.set(other, [...(threads.get(other) ?? []), msg]);
  }
  return (
    <div className="pg-c">
      <aside className="pg-index">
        <span className="black-label">Ники</span>
        <ul>
          {nicks.map(([name, count]) => (
            <li key={name}><button className={name === nick ? 'on' : ''} onClick={() => setNick(name)}><span>{name}</span><span className="pg-muted">{count}</span></button></li>
          ))}
        </ul>
        <p className="pg-muted">Только уникальные ники. «Лена», «Катя» и подписи с фамилиями профиля не получают.</p>
      </aside>
      <section className="pg-c-main">
        <h2 className="pg-c-nick">{nick}</h2>
        <div className="pg-stats">
          <span><b>{own.length}</b> сообщений</span><span><b>{about.length}</b> упоминаний</span><span><b>{profile.articles.length}</b> материалов в газете</span>
        </div>
        {profile.articles.length > 0 && (
          <div className="pg-shelf">
            {profile.articles.map((article) => (
              <a key={article.issue + article.title} href={`#issue-${article.issue}-p${article.page}`} className="pg-clip">
                <span className="pg-muted">{issueLabel(article.issue)}</span><b>{article.title}</b>
              </a>
            ))}
          </div>
        )}
        {[...threads].map(([other, list]) => (
          <div key={other} className="pg-thread-box">
            <h3>{nick} <span className="pg-muted">и</span> <Name name={other} onOpen={setNick} /></h3>
            {list.map((msg) => (
              <div key={msg.id} className={`pg-bubble ${msg.nick === nick ? 'mine' : ''}`}>
                <span className="pg-muted">{msg.from} · {dateLabel(msg.date)} · <a href={pageHref(msg)}>{issueLabel(msg.issue)}</a></span>
                <p>{msg.text}</p>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}

function PrototypeSwitcher({ current, onChange }: { current: VariantKey; onChange: (key: VariantKey) => void }) {
  const index = VARIANTS.findIndex((v) => v.key === current);
  const step = (delta: number) => onChange(VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length].key);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable]')) return;
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return null;
  return (
    <div className="pg-switcher" role="toolbar" aria-label="Прототип: варианты">
      <button onClick={() => step(-1)} aria-label="Предыдущий вариант"><ArrowLeft size={16} /></button>
      <span>{current} · {VARIANTS[index].name}</span>
      <button onClick={() => step(1)} aria-label="Следующий вариант"><ArrowRight size={16} /></button>
    </div>
  );
}

export default function PageerPrototype() {
  const read = () => (new URLSearchParams(window.location.search).get('variant')?.toUpperCase() ?? 'A') as VariantKey;
  const [variant, setVariant] = useState<VariantKey>(VARIANTS.some((v) => v.key === read()) ? read() : 'A');
  const change = (key: VariantKey) => {
    const url = new URL(window.location.href);
    url.searchParams.set('variant', key);
    window.history.replaceState(null, '', url);
    setVariant(key);
  };
  return (
    <main id="main" className="shell pg-root">
      <style>{CSS}</style>
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
      <PrototypeSwitcher current={variant} onChange={change} />
    </main>
  );
}

const CSS = `
.pg-root { padding: 32px 0 120px; }
.pg-muted { color: var(--muted); font-size: 14px; }
.pg-name { border: 0; background: none; padding: 0; font: inherit; color: inherit; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; cursor: pointer; }
.pg-name:hover { background: var(--accent); }
.pg-avatar { width: 40px; height: 40px; flex: none; display: grid; place-items: center; background: var(--ink); color: var(--paper); font: 700 14px 'Roboto Condensed', sans-serif; }
.pg-post { display: flex; gap: 14px; padding: 18px 0; border-bottom: 1px solid var(--line); }
.pg-post > div { min-width: 0; flex: 1; }
.pg-post header { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; font-size: 16px; }
.pg-to { color: var(--muted); font-size: 14px; }
.pg-parent { display: block; margin-top: 6px; padding: 6px 10px; border-left: 3px solid var(--ink); background: var(--secondary); font-size: 13px; color: var(--muted); }
.pg-text { margin-top: 8px; font-size: 16px; line-height: 1.5; text-wrap: pretty; overflow-wrap: anywhere; }
.pg-retold { display: inline-block; margin-left: 6px; padding: 1px 6px; border: 1px dashed var(--muted); font-size: 12px; font-style: normal; color: var(--muted); }
.pg-post footer { margin-top: 8px; font-size: 13px; color: var(--muted); }
.pg-post footer a:hover { text-decoration: underline; }
.pg-intro { display: grid; gap: 12px; justify-items: start; }
.pg-intro h2 { font-size: 56px; font-weight: 800; letter-spacing: -1px; line-height: .95; }
.pg-intro p { color: var(--muted); line-height: 1.5; }
/* A */
.pg-a { display: grid; grid-template-columns: 290px minmax(0, 640px); gap: 64px; }
.pg-rail { position: sticky; top: 24px; align-self: start; display: grid; gap: 24px; padding-top: 8px; }
.pg-months { display: flex; flex-wrap: wrap; gap: 6px; }
.pg-months a { padding: 4px 10px; border: 1px solid var(--ink); font-size: 14px; text-transform: capitalize; }
.pg-months a:hover { background: var(--ink); color: var(--paper); }
.pg-month { position: sticky; top: 0; z-index: 1; padding: 10px 0; background: var(--paper); border-bottom: 5px solid var(--ink); font-size: 26px; }
.pg-month::first-letter { text-transform: uppercase; }
.pg-cta { justify-self: start; padding: 10px 16px; border: 1px solid var(--ink); background: transparent; font-weight: 500; }
.pg-cta:hover { background: var(--ink); color: var(--paper); }
/* profile */
.pg-profile { display: grid; gap: 14px; align-content: start; justify-items: start; min-width: 0; }
.pg-profile h2 { font-size: 72px; font-weight: 800; letter-spacing: -2px; line-height: .9; overflow-wrap: anywhere; }
.pg-profile.compact h2 { font-size: 44px; }
.pg-back { display: inline-flex; gap: 6px; align-items: center; border: 0; background: none; padding: 0; color: var(--muted); }
.pg-stats { display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 12px 0; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); width: 100%; font-size: 14px; }
.pg-stats b { font: 800 22px 'Roboto Condensed', sans-serif; margin-right: 4px; }
.pg-tabs { display: flex; gap: 0; border: 1px solid var(--ink); }
.pg-tabs button { display: inline-flex; gap: 6px; align-items: center; padding: 9px 14px; border: 0; border-right: 1px solid var(--ink); background: transparent; font-size: 14px; font-weight: 500; }
.pg-tabs button:last-child { border-right: 0; }
.pg-tabs button.on { background: var(--ink); color: var(--paper); }
.pg-profile .pg-feed, .pg-dialogs { width: 100%; display: grid; gap: 18px; }
.pg-articles { list-style: none; margin: 0; padding: 0; width: 100%; border-top: 5px solid var(--ink); }
.pg-articles a { display: grid; gap: 2px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.pg-articles a:hover b { text-decoration: underline; }
/* B */
.pg-b-mast { display: flex; flex-wrap: wrap; align-items: end; gap: 12px 28px; padding: 28px 32px; border-bottom: 5px solid var(--ink); background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size: 22px 22px; }
.pg-b-title { font: 900 clamp(48px, 9vw, 120px) 'Roboto Condensed', sans-serif; letter-spacing: -3px; line-height: .85; }
.pg-b-mast > span:last-child { max-width: 360px; color: var(--muted); line-height: 1.45; }
.pg-strip { padding: 28px 0 8px; border-bottom: 1px solid var(--ink); }
.pg-strip header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin-bottom: 16px; font-size: 14px; }
.pg-strip header a { margin-left: auto; font-weight: 500; }
.pg-strip header a:hover { text-decoration: underline; }
.pg-columns { columns: 3 260px; column-gap: 28px; column-rule: 1px solid var(--line); font: 15px/1.45 Georgia, 'Times New Roman', serif; }
.pg-columns p { break-inside: avoid; margin: 0 0 12px; text-align: justify; hyphens: auto; }
.pg-columns p .pg-name, .pg-columns p > b { font-family: 'Roboto Condensed', sans-serif; }
.pg-columns p.reply { padding-left: 10px; border-left: 3px solid var(--accent); }
.pg-thread { font: 12px 'Roboto', sans-serif; color: var(--muted); }
.pg-drawer { position: fixed; z-index: 20; top: 0; right: 0; bottom: 0; width: min(520px, 100%); overflow: auto; padding: 28px; background: var(--paper); border-left: 5px solid var(--ink); box-shadow: -12px 0 40px rgb(0 0 0 / .12); }
/* C */
.pg-c { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 48px; }
.pg-index { position: sticky; top: 24px; align-self: start; display: grid; gap: 12px; justify-items: start; }
.pg-index ul { list-style: none; margin: 0; padding: 0; width: 100%; border-top: 5px solid var(--ink); }
.pg-index button { width: 100%; display: flex; justify-content: space-between; padding: 9px 8px; border: 0; border-bottom: 1px solid var(--line); background: transparent; text-align: left; font-size: 15px; }
.pg-index button:hover { background: var(--secondary); }
.pg-index button.on { background: var(--ink); color: var(--paper); }
.pg-index button.on .pg-muted { color: var(--paper); }
.pg-c-main { display: grid; gap: 20px; align-content: start; min-width: 0; }
.pg-c-nick { font-size: clamp(56px, 10vw, 128px); font-weight: 900; letter-spacing: -3px; line-height: .85; overflow-wrap: anywhere; }
.pg-shelf { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; }
.pg-clip { flex: 0 0 220px; display: grid; gap: 6px; align-content: start; padding: 14px; border: 1px solid var(--ink); border-bottom-width: 5px; background: #fff; }
.pg-clip:hover { background: var(--accent); }
.pg-thread-box { display: grid; gap: 10px; padding-top: 14px; border-top: 1px solid var(--ink); }
.pg-thread-box h3 { font-size: 22px; }
.pg-permalink { margin-left: 8px; color: var(--muted); font-weight: 400; }
.pg-permalink:hover { color: var(--ink); }
.pg-bubble { max-width: min(560px, 88%); padding: 10px 14px; border: 1px solid var(--ink); background: #fff; }
.pg-bubble.mine { justify-self: end; background: var(--ink); color: var(--paper); }
.pg-bubble.mine .pg-muted, .pg-bubble.mine a { color: #c9cabe; }
.pg-bubble p { margin-top: 4px; line-height: 1.45; overflow-wrap: anywhere; }
.pg-switcher { position: fixed; z-index: 50; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; padding: 6px; border-radius: 999px; background: #ff3d7f; color: #fff; box-shadow: 0 8px 24px rgb(0 0 0 / .25); font: 600 14px system-ui, sans-serif; }
.pg-switcher span { padding: 0 10px; white-space: nowrap; }
.pg-switcher button { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 999px; background: rgb(255 255 255 / .2); color: #fff; }
@media (max-width: 900px) {
  .pg-a, .pg-c { grid-template-columns: 1fr; gap: 28px; }
  .pg-rail, .pg-index { position: static; }
  .pg-index ul { display: flex; overflow-x: auto; border-top: 0; gap: 6px; }
  .pg-index li { flex: none; }
  .pg-index button { width: auto; gap: 8px; border: 1px solid var(--ink); }
  .pg-index p { display: none; }
  .pg-intro h2 { font-size: 44px; }
  .pg-profile h2 { font-size: 48px; }
  .pg-tabs { flex-wrap: wrap; }
}
`;
