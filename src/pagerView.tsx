// The «Пейджер» section: a feed of readers' pager messages, oldest first, with a profile for
// every unique nick. Loaded as a separate chunk; pager.json is fetched on the first open.
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {ArrowLeft, AtSign, Check, FileText, Link, MessageSquare, MessageSquareQuote, MessagesSquare, Search, X} from "lucide-react";
import {pagerUrl} from "./config";
import {issueLabel, isSpecial, type Issue} from "./metadata";
import {createPagerSearchRecorder, trackPagerDialog, trackPagerOpen, trackPagerProfile} from "./pagerAnalytics";
import {
  MIN_QUERY,
  addressedTo,
  articlesOf,
  dateLabel,
  dialogsOf,
  excerptFor,
  issueParts,
  mentionsOf,
  remarksOf,
  monthLabel,
  pagerSearchIndex,
  plural,
  pluralWord,
  preparePager,
  profileOf,
  searchPager,
  type Dialog,
  type FeedMessage,
  type PagerHit,
  type PagerModel,
  type PagerRoute,
  type PagerTab,
} from "./pagerFeed";
import {go, onRoute} from "./navigation";
import {pagerPath, pagerRouteOf, readableUrl} from "./pagerRoute";
import type {PagerSite, SiteProfile} from "./pagerSite";

let request: Promise<PagerModel> | null = null;
function loadPager() {
  request ??= fetch(pagerUrl(), {cache: "no-cache"})
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
    .then((site: PagerSite) => preparePager(site))
    .catch((error) => {
      request = null;
      throw error;
    });
  return request;
}

const EMPTY_ROUTE: PagerRoute = {nick: null, tab: "own", with: null};
function usePagerRoute() {
  const here = () => pagerRouteOf(window.location.pathname, window.location.hash);
  const [route, setRoute] = useState(() => here() ?? EMPTY_ROUTE);
  useEffect(
    () =>
      onRoute(() => {
        const next = here();
        if (next) setRoute(next);
      }),
    [],
  );
  return route;
}

// Long lists grow in chunks as the reader scrolls: thousands of posts at once are slow on phones.
const CHUNK = 80;
function useChunks(total: number) {
  const [count, setCount] = useState(CHUNK);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || count >= total || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setCount((value) => value + CHUNK);
      },
      {rootMargin: "1500px 0px"},
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [count, total]);
  const more =
    count < total ? (
      <div ref={sentinel} className="pg-more">
        <button type="button" onClick={() => setCount((value) => value + CHUNK)}>
          Показать ещё
        </button>
        <span>
          Показано {count} из {total}
        </span>
      </div>
    ) : null;
  return {count, more};
}

// From «/pager/…» an issue is «/#issue-…»: a relative hash would stay under the pager path.
const pageHref = (message: FeedMessage) => `/#issue-${message.issue}-p${message.page}`;
const profileHref = (profile: SiteProfile, tab: PagerTab = "own", other?: SiteProfile) =>
  pagerPath(profile.name, tab, other?.name);

function Avatar({name}: {name: string | null}) {
  const letters = (name ?? "").replace(/[^\p{L}\p{N}@]/gu, "").slice(0, 2).toUpperCase() || "—";
  return (
    <span className="pg-avatar" aria-hidden="true">
      {letters}
    </span>
  );
}

function ProfileLink({profile, children}: {profile: SiteProfile; children?: React.ReactNode}) {
  return (
    <a className="pg-name" href={profileHref(profile)}>
      {children ?? profile.name}
    </a>
  );
}

// The signature as printed; it links to the profile when it is a unique nick. A joint signature
// («Kurt & Kurtочк@») lists each author's profile after it.
function Signature({model, message}: {model: PagerModel; message: FeedMessage}) {
  if (!message.from) return <span className="pg-muted">Без подписи</span>;
  const profiles = message.nicks.map((key) => model.profiles.get(key)).filter((profile): profile is SiteProfile => !!profile);
  if (profiles.length === 1)
    return (
      <ProfileLink profile={profiles[0]}>
        <b>{message.from}</b>
      </ProfileLink>
    );
  return (
    <span>
      <b>{message.from}</b>
      {profiles.length > 1 && (
        <span className="pg-joint">
          {" ("}
          {profiles.map((profile, i) => (
            <span key={profile.key}>
              {i ? ", " : ""}
              <ProfileLink profile={profile} />
            </span>
          ))}
          {")"}
        </span>
      )}
    </span>
  );
}

function Where({message}: {message: FeedMessage}) {
  const issue = issueParts(message.issue);
  return (
    <a href={pageHref(message)}>
      {isSpecial(issue) ? "" : `${dateLabel(message.date)} · `}
      {issueLabel(issue)} · стр. {message.pages}
    </a>
  );
}

function Post({model, message}: {model: PagerModel; message: FeedMessage}) {
  return (
    <article className="pg-post">
      <Avatar name={message.from} />
      <div>
        <header>
          <Signature model={model} message={message} />
          {message.to.length > 0 && (
            <span className="pg-to">
              →{" "}
              {message.to.map((name, i) => {
                const key = message.toKeys[i];
                const profile = key ? model.profiles.get(key) : undefined;
                return (
                  <span key={`${name}-${i}`}>
                    {i ? ", " : ""}
                    {profile ? <ProfileLink profile={profile}>{name}</ProfileLink> : name}
                  </span>
                );
              })}
            </span>
          )}
        </header>
        <p className="pg-text">{message.text}</p>
        <footer>
          <Where message={message} />
        </footer>
      </div>
    </article>
  );
}

function PostList({model, messages, empty}: {model: PagerModel; messages: FeedMessage[]; empty: string}) {
  const {count, more} = useChunks(messages.length);
  if (!messages.length) return <p className="pg-muted">{empty}</p>;
  return (
    <div className="pg-list">
      {messages.slice(0, count).map((message) => (
        <Post key={message.id} model={model} message={message} />
      ))}
      {more}
    </div>
  );
}

function Feed({model, messages}: {model: PagerModel; messages: FeedMessage[]}) {
  const {count, more} = useChunks(messages.length);
  const months = useMemo(() => {
    const groups: [string, FeedMessage[]][] = [];
    for (const message of messages.slice(0, count)) {
      const month = message.date.slice(0, 7);
      if (groups.at(-1)?.[0] !== month) groups.push([month, []]);
      groups.at(-1)![1].push(message);
    }
    return groups;
  }, [messages, count]);
  return (
    <div className="pg-feed">
      {months.map(([month, list]) => (
        <section key={month} aria-label={monthLabel(month)}>
          <h2 className="pg-month">{monthLabel(month)}</h2>
          {list.map((message) => (
            <Post key={message.id} model={model} message={message} />
          ))}
        </section>
      ))}
      {more}
    </div>
  );
}

function Dialogs({model, profile, dialogs, only}: {model: PagerModel; profile: SiteProfile; dialogs: Dialog[]; only: string | null}) {
  const otherKey = only ? profileOf(model, only) : null;
  const shown = only ? dialogs.filter((dialog) => dialog.other === otherKey) : dialogs;
  return (
    <div className="pg-dialogs">
      {only && (
        <a className="pg-back" href={profileHref(profile, "dialogs")}>
          <ArrowLeft size={16} aria-hidden="true" /> Все диалоги {profile.name}
        </a>
      )}
      {!dialogs.length && <p className="pg-muted">Переписки с другими никами нет.</p>}
      {only && dialogs.length > 0 && !shown.length && <p className="pg-muted">Диалога с {only} нет.</p>}
      {shown.map((dialog) => {
        const other = model.profiles.get(dialog.other)!;
        return (
          <section key={dialog.other} className="pg-thread">
            <h3>
              {profile.name} <span className="pg-muted">и</span> <ProfileLink profile={other} />
              {!only && (
                <a className="pg-permalink" href={profileHref(profile, "dialogs", other)} title="Ссылка на этот диалог" aria-label={`Ссылка на диалог с ${other.name}`}>
                  #
                </a>
              )}
            </h3>
            {dialog.messages.map((message) => {
              const mine = message.nicks.includes(profile.key);
              // One coupon a week greeted several people: show only the part for the other side.
              const part = excerptFor(model, message, mine ? dialog.other : profile.key);
              return (
                <div key={message.id} className={`pg-bubble${mine ? " mine" : ""}`}>
                  <span className="pg-bubble-meta">
                    {message.from ?? "Без подписи"} · <Where message={message} />
                  </span>
                  <BubbleText text={message.text} part={part} />
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function BubbleText({text, part}: {text: string; part: string | null}) {
  const [whole, setWhole] = useState(false);
  if (!part || whole) return <p>{text}</p>;
  return (
    <p>
      {part}{" "}
      <button type="button" className="pg-whole" onClick={() => setWhole(true)}>
        всё сообщение
      </button>
    </p>
  );
}

function Stat({count, forms}: {count: number; forms: [string, string, string]}) {
  return (
    <span>
      <b>{count}</b> {pluralWord(count, ...forms)}
    </span>
  );
}

const KIND: Record<string, string> = {article: "статья", letter: "письмо", drawing: "рисунок", photo: "фото", other: "материал"};

// Copying the address bar gives «#pager/%D0%A1…» (the browser keeps the URL encoded), so the
// profile offers its own link with the letters as letters. It copies the current tab or dialog.
function CopyLink() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    void navigator.clipboard?.writeText(readableUrl(window.location.href)).then(() => setCopied(true), () => undefined);
  };
  const Icon = copied ? Check : Link;
  const label = copied ? "Ссылка скопирована" : "Скопировать ссылку";
  return (
    <button type="button" className="pg-copy" onClick={copy} title={label} aria-label={label}>
      <Icon size={22} aria-hidden="true" />
    </button>
  );
}

function Profile({model, profile, route, issues}: {model: PagerModel; profile: SiteProfile; route: PagerRoute; issues: Issue[]}) {
  const own = model.own.get(profile.key) ?? [];
  const about = useMemo(() => mentionsOf(model, profile.key), [model, profile.key]);
  const dialogs = useMemo(() => (route.tab === "dialogs" ? dialogsOf(model, profile.key, about) : []), [model, profile.key, about, route.tab]);
  // The catalog only adds a date; the articles themselves come from the published authors index.
  const catalog = useMemo(() => new Map(issues.map((issue) => [`${issue.year}-${issue.number}-${issue.serial}`, issue])), [issues]);
  const articles = articlesOf(model, profile.key);
  const dates = own.map((message) => message.date).sort();
  const first = dates[0] ?? profile.first;
  const last = dates.at(-1) ?? profile.last;
  const remarks = useMemo(() => remarksOf(model, profile.key), [model, profile.key]);
  const tabs: [PagerTab, string, typeof MessageSquare][] = [
    ["own", "Сообщения", MessageSquare],
    ["about", "Упоминания", AtSign],
    // Only those who commented on others' messages (ПТ, ТТ) have the tab.
    ...(remarks.length ? [["remarks", "Комментарии", MessageSquareQuote] as [PagerTab, string, typeof MessageSquare]] : []),
    ["articles", "В газете", FileText],
    ["dialogs", "Диалоги", MessagesSquare],
  ];
  return (
    <section className="pg-profile" aria-label={`Профиль ${profile.name}`}>
      <a className="pg-back" href="/pager">
        <ArrowLeft size={16} aria-hidden="true" /> К ленте
      </a>
      <span className="black-label">{profile.staff ? "Профиль · редакция «ПП»" : "Профиль"}</span>
      <div className="pg-title">
        <h1>{profile.name}</h1>
        <CopyLink />
      </div>
      {profile.spellings.length > 0 && <p className="pg-muted">Также подписывался: {profile.spellings.join(", ")}</p>}
      {profile.bylines && (
        <p className="pg-muted">
          В газете: <a href={profileHref(profile, "articles")}>{profile.bylines.join(", ")}</a>
        </p>
      )}
      <div className="pg-stats">
        <Stat count={own.length} forms={["сообщение", "сообщения", "сообщений"]} />
        <Stat count={about.length} forms={["упоминание", "упоминания", "упоминаний"]} />
        {remarks.length > 0 && <Stat count={remarks.length} forms={["комментарий", "комментария", "комментариев"]} />}
        <Stat count={articles.length} forms={["материал", "материала", "материалов"]} />
        {first && <span>{first === last ? dateLabel(first) : `${dateLabel(first)} — ${dateLabel(last)}`}</span>}
      </div>
      <nav className="pg-tabs" aria-label="Разделы профиля">
        {tabs.map(([tab, label, Icon]) => (
          <a key={tab} href={profileHref(profile, tab)} className={route.tab === tab ? "on" : ""} aria-current={route.tab === tab ? "page" : undefined}>
            <Icon size={15} aria-hidden="true" /> {label}
          </a>
        ))}
      </nav>
      {route.tab === "dialogs" ? (
        <Dialogs model={model} profile={profile} dialogs={dialogs} only={route.with} />
      ) : route.tab === "articles" ? (
        <ul className="pg-articles">
          {articles.map((article) => {
            const issue = issueParts(article.issue);
            const dated = catalog.get(article.issue);
            return (
              <li key={`${article.issue}-${article.page}-${article.title ?? ""}`}>
                <a href={`/#issue-${article.issue}-p${article.page}`}>
                  <span className="pg-muted">
                    {issueLabel(issue)}
                    {dated && !isSpecial(issue) ? ` · ${dated.dateLabel}` : ""} · стр. {article.page} · {KIND[article.kind] ?? KIND.other}
                  </span>
                  <b>{article.title || "Без заголовка"}</b>
                </a>
              </li>
            );
          })}
          {!articles.length && <li className="pg-muted">Подписанных этим ником материалов в архиве нет.</li>}
        </ul>
      ) : route.tab === "remarks" ? (
        <PostList key={`${profile.key}-remarks`} model={model} messages={remarks} empty="Комментариев к чужим сообщениям нет." />
      ) : route.tab === "about" ? (
        <PostList key={`${profile.key}-about`} model={model} messages={about} empty="Никто не обращался к этому нику и не упоминал его." />
      ) : (
        <PostList key={`${profile.key}-own`} model={model} messages={own} empty="Сообщений нет." />
      )}
    </section>
  );
}

// Search like the author search (same matching and the same accounting), over nicks with a
// profile (opens it) and addressees (filters the feed). Real «Имя Фамилия» addressees are not in it.
function PagerSearch({model, onAddressee}: {model: PagerModel | null; onAddressee: (hit: PagerHit) => void}) {
  const [query, setQuery] = useState("");
  const index = useMemo(() => (model ? pagerSearchIndex(model) : null), [model]);
  const recorder = useMemo(() => createPagerSearchRecorder(), []);
  useEffect(() => () => recorder.close(), [recorder]);
  const matches = useMemo(() => (index ? searchPager(index, query) : []), [index, query]);
  const long = query.trim().length >= MIN_QUERY;
  const choose = (hit: PagerHit) => {
    recorder.select(hit.name, hit.kind);
    setQuery("");
    if (hit.kind === "author") go(pagerPath(hit.name));
    else onAddressee(hit);
  };
  return (
    <section className="author-search pg-search" aria-label="Поиск по пейджеру">
      <label className="visually-hidden" htmlFor="pager-search">
        Найти ник
      </label>
      <div className="author-search-field">
        <Search size={20} aria-hidden="true" />
        <input
          id="pager-search"
          type="search"
          autoComplete="off"
          placeholder="Ник автора или адресата"
          value={query}
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls="pager-suggestions"
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (index) recorder.type(next, searchPager(index, next).length);
          }}
          onBlur={() => recorder.flush()}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) choose(matches[0]);
            if (event.key === "Escape") setQuery("");
          }}
        />
      </div>
      {matches.length > 0 && (
        <ul className="author-suggestions" id="pager-suggestions" role="listbox">
          {matches.map((hit) => (
            <li key={`${hit.kind}-${hit.key}`} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(hit)}>
                <span>{hit.name}</span>
                <span className="author-count">
                  {hit.kind === "author" ? "ник" : "адресат"} · {hit.count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {long && index && !matches.length && <p className="author-empty">Такого ника среди авторов и адресатов нет.</p>}
      {!long && model && model.featured.length > 0 && (
        <p className="pg-examples">
          Например:{" "}
          {model.featured.map((name, i) => (
            <span key={name}>
              {i > 0 && ", "}
              <a href={pagerPath(name)}>{name}</a>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

function Intro({model, compact}: {model: PagerModel | null; compact: boolean}) {
  return (
    <div className={`pg-intro${compact ? " compact" : ""}`}>
      <span className="black-label">Pager</span>
      <h2>Пейджер</h2>
      <p>
        Приветы, ответы и перебранки читателей «Пилота» — от первых номеров к последним. Ник, у которого есть профиль, —
        ссылка.
      </p>
      {model && <p className="pg-count">{plural(model.messages.length, "сообщение", "сообщения", "сообщений")}</p>}
    </div>
  );
}

export default function PagerSection({issues}: {issues: Issue[]}) {
  const route = usePagerRoute();
  const [model, setModel] = useState<PagerModel | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [addressee, setAddressee] = useState<PagerHit | null>(null);

  useEffect(() => trackPagerOpen(), []);
  useEffect(() => {
    let live = true;
    setFailed(false);
    loadPager().then(
      (next) => live && setModel(next),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const profileKey = model && route.nick ? profileOf(model, route.nick) : null;
  const profile = profileKey ? model!.profiles.get(profileKey) ?? null : null;
  const otherKey = model && profile && route.tab === "dialogs" && route.with ? profileOf(model, route.with) : null;
  const other = otherKey ? model!.profiles.get(otherKey) ?? null : null;

  useEffect(() => {
    if (profile) trackPagerProfile(profile.name);
  }, [profile]);
  useEffect(() => {
    if (profile && other) trackPagerDialog(profile.name, other.name);
  }, [profile, other]);
  useEffect(() => {
    document.title = profile ? `${profile.name} · Пейджер · Первый Пилот` : "Пейджер · Первый Пилот";
  }, [profile]);

  // The feed stays mounted (hidden) under a profile, so Back returns to the same place in it.
  const feedScroll = useRef(0);
  const onFeed = !route.nick;
  useEffect(() => {
    if (!onFeed) return;
    const remember = () => {
      feedScroll.current = window.scrollY;
    };
    window.addEventListener("scroll", remember, {passive: true});
    return () => window.removeEventListener("scroll", remember);
  }, [onFeed]);
  useLayoutEffect(() => {
    window.scrollTo(0, onFeed ? feedScroll.current : 0);
  }, [onFeed, route.nick]);

  const shown = useMemo(() => (model ? (addressee ? addressedTo(model, addressee.key) : model.messages) : []), [model, addressee]);

  const chooseAddressee = (hit: PagerHit) => {
    feedScroll.current = 0;
    setAddressee(hit);
    if (route.nick) go(pagerPath());
    else window.scrollTo(0, 0);
  };

  return (
    <main id="main" className="shell pager-page">
      <aside className="pg-rail">
        <Intro model={model} compact={!onFeed} />
        <PagerSearch model={model} onAddressee={chooseAddressee} />
      </aside>
      <div className="pg-main">
        {!model && !failed && <p className="pg-muted pg-status">Загружаем сообщения…</p>}
        {failed && (
          <p className="pg-status">
            Пейджер пока недоступен.{" "}
            <button type="button" className="pg-retry" onClick={() => setAttempt((value) => value + 1)}>
              Попробовать ещё раз
            </button>
          </p>
        )}
        {model && (
          <div hidden={!onFeed}>
            {addressee && (
              <p className="pg-filter">
                <span>
                  Сообщения для <b>{addressee.name}</b>: {shown.length}
                </span>
                <button type="button" onClick={() => setAddressee(null)}>
                  <X size={14} aria-hidden="true" /> сбросить
                </button>
              </p>
            )}
            <Feed key={addressee?.key ?? ""} model={model} messages={shown} />
          </div>
        )}
        {model && route.nick && !profile && (
          <div className="pg-profile">
            <a className="pg-back" href="/pager">
              <ArrowLeft size={16} aria-hidden="true" /> К ленте
            </a>
            <p>У подписи «{route.nick}» нет профиля: профили есть только у отличительных ников.</p>
          </div>
        )}
        {model && profile && <Profile model={model} profile={profile} route={route} issues={issues} />}
      </div>
    </main>
  );
}
