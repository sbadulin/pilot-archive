import {useCallback, useEffect, useId, useMemo, useState} from "react";
import {ArrowLeft, Search} from "lucide-react";
import {jsonRequest} from "./ingestionClient";
import {matchesQuery, MIN_QUERY} from "./authorSearch";
import type {Issue} from "./metadata";

type NameRow = {name: string; key: string; count: number; hidden: number};
type CreditRow = {
  id: string;
  year: number;
  number: string;
  serial: string;
  page: number;
  kind: string;
  title: string | null;
  byline: string;
  status: "auto" | "confirmed" | "hidden";
  source: string;
};

const KIND: Record<string, string> = {article: "статья", letter: "письмо", pager: "пейджер", photo: "фото", drawing: "рисунок", other: "другое"};

const issueKey = (issue: Issue) => `${issue.year}-${issue.number}-${issue.serial}`;

// A byline the recognition missed. The chosen name, if any, is prefilled.
function AddCredit({issues, names, name, busy, onAdd}: {issues: Issue[]; names: NameRow[] | null; name: string | null; busy: boolean; onAdd: (credit: Record<string, unknown>) => Promise<void>}) {
  const id = useId();
  const [issue, setIssue] = useState("");
  const [page, setPage] = useState("");
  const [author, setAuthor] = useState(name ?? "");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("article");
  useEffect(() => setAuthor(name ?? ""), [name]);
  const chosen = issues.find((item) => issueKey(item) === issue);
  const ready = chosen && Number(page) >= 1 && author.trim();
  return (
    <form
      className="curator-add"
      onSubmit={(event) => {
        event.preventDefault();
        if (!chosen || !ready) return;
        void onAdd({year: chosen.year, number: chosen.number, serial: chosen.serial, page: Number(page), name: author.trim(), title: title.trim(), kind}).then(() => {
          setPage("");
          setTitle("");
        });
      }}
    >
      <h2>Добавить пропущенную подпись</h2>
      <label htmlFor={`${id}-issue`}>Номер</label>
      <select id={`${id}-issue`} value={issue} onChange={(e) => setIssue(e.target.value)}>
        <option value="">Выберите номер</option>
        {issues.map((item) => (
          <option key={issueKey(item)} value={issueKey(item)}>
            № {item.number} ({item.serial}) · {item.dateLabel}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-page`}>Страница</label>
      <input id={`${id}-page`} type="number" min={1} max={100} inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value)} />
      <label htmlFor={`${id}-name`}>Имя, как в подписи</label>
      <input id={`${id}-name`} list={`${id}-names`} value={author} onChange={(e) => setAuthor(e.target.value)} />
      <datalist id={`${id}-names`}>
        {names?.map((row) => <option key={row.name} value={row.name} />)}
      </datalist>
      <label htmlFor={`${id}-title`}>Заголовок материала</label>
      <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Необязательно" />
      <label htmlFor={`${id}-kind`}>Тип</label>
      <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="article">статья</option>
        <option value="letter">письмо</option>
        <option value="photo">фото</option>
        <option value="drawing">рисунок</option>
        <option value="other">другое</option>
      </select>
      <button type="submit" disabled={busy || !ready}>Добавить</button>
    </form>
  );
}

// Curator page: fix misread names, merge spellings, hide wrong credits, add missed ones. Admin build only.
export function CuratorAuthors({issues, onBack}: {issues: Issue[]; onBack: () => void}) {
  const listId = useId();
  const [names, setNames] = useState<NameRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [credits, setCredits] = useState<CreditRow[] | null>(null);
  const [rename, setRename] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadNames = useCallback(
    () =>
      jsonRequest<{names: NameRow[]}>("/api/admin/authors/names")
        .then((payload) => setNames(payload.names))
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => void loadNames(), [loadNames]);

  const open = useCallback((name: string, keepMessage = false) => {
    setSelected(name);
    setRename(name);
    setCredits(null);
    if (!keepMessage) setMessage("");
    jsonRequest<{credits: CreditRow[]}>(`/api/admin/authors/credits?name=${encodeURIComponent(name)}`)
      .then((payload) => setCredits(payload.credits))
      .catch((e: Error) => setError(e.message));
  }, []);

  const matches = useMemo(
    () =>
      (names ?? [])
        .filter((row) => matchesQuery(query, [row.key]))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30),
    [names, query],
  );
  const existing = names?.some((row) => row.name === rename.trim() && row.name !== selected);

  const act = async (run: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    try {
      await run();
      setMessage(done);
      await loadNames();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveName = () => {
    const to = rename.trim();
    if (!selected || !to || to === selected) return;
    void act(
      () => jsonRequest("/api/admin/authors/rename", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({from: selected, to})}),
      existing ? `«${selected}» объединено с «${to}».` : `Переименовано в «${to}».`,
    ).then(() => open(to, true));
  };

  const setStatus = (credit: CreditRow, status: CreditRow["status"]) =>
    act(
      () => jsonRequest(`/api/admin/credits/${credit.id}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({status})}),
      status === "hidden" ? "Запись скрыта из поиска." : "Запись снова в поиске.",
    ).then(() => setCredits((rows) => rows?.map((row) => (row.id === credit.id ? {...row, status} : row)) ?? null));

  return (
    <main id="main" className="shell curator-authors">
      <button className="text-button back-link" onClick={onBack}>
        <ArrowLeft size={18} />К архиву
      </button>
      <h1>Имена авторов</h1>
      <p className="curator-lead">
        Имена распознаны по подписям под материалами. Исправьте ошибки распознавания, объедините варианты написания одного
        имени или скройте запись, если это не подпись. Правки сохраняются при повторном распознавании номера и сразу
        попадают в поиск на сайте.
      </p>
      <button
        type="button"
        className="curator-publish"
        disabled={busy}
        onClick={() =>
          void act(
            () => jsonRequest<{names: number}>("/api/admin/authors/rebuild-index", {method: "POST"}),
            "Поиск на сайте обновлён.",
          )
        }
      >
        Обновить поиск на сайте
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="curator-message" role="status">{message}</p>}
      <div className="curator-layout">
        <section aria-label="Поиск имени">
          <label className="black-label" htmlFor={`${listId}-q`}>Найти имя</label>
          <div className="author-search-field">
            <Search size={20} aria-hidden="true" />
            <input id={`${listId}-q`} type="search" autoComplete="off" placeholder={`От ${MIN_QUERY} букв`} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {names === null && !error && <p className="loading-message" role="status">Загружаем имена…</p>}
          {names && query.trim().length >= MIN_QUERY && (
            <ul className="curator-names">
              {matches.map((row) => (
                <li key={row.name}>
                  <button type="button" className={row.name === selected ? "selected" : ""} onClick={() => open(row.name)}>
                    <span>{row.name}</span>
                    <span className="author-count">{row.count}{row.hidden ? `, скрыто ${row.hidden}` : ""}</span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="author-empty">Ничего не нашли.</li>}
            </ul>
          )}
          <AddCredit
            issues={issues}
            names={names}
            name={selected}
            busy={busy}
            onAdd={(credit) =>
              act(
                () => jsonRequest("/api/admin/credits", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(credit)}),
                `Подпись «${credit.name}» добавлена.`,
              ).then(() => open(String(credit.name), true))
            }
          />
        </section>
        {selected && (
          <section className="curator-name" aria-label={`Имя ${selected}`}>
            <h2>{selected}</h2>
            <form
              className="curator-rename"
              onSubmit={(e) => {
                e.preventDefault();
                saveName();
              }}
            >
              <label htmlFor={`${listId}-rename`}>Правильное написание</label>
              <input id={`${listId}-rename`} list={`${listId}-all`} value={rename} onChange={(e) => setRename(e.target.value)} />
              <datalist id={`${listId}-all`}>
                {names?.map((row) => <option key={row.name} value={row.name} />)}
              </datalist>
              <button type="submit" disabled={busy || !rename.trim() || rename.trim() === selected}>
                {existing ? "Объединить" : "Переименовать"}
              </button>
              {existing && <p className="curator-hint">Такое имя уже есть: все материалы «{selected}» перейдут к нему.</p>}
            </form>
            {credits === null ? (
              <p className="loading-message" role="status">Загружаем материалы…</p>
            ) : (
              <ul className="curator-credits">
                {credits.map((credit) => (
                  <li key={credit.id} className={credit.status === "hidden" ? "hidden-credit" : ""}>
                    <a href={`#issue-${credit.year}-${credit.number}-${credit.serial}-p${credit.page}`} target="_blank" rel="noreferrer">
                      № {credit.number} ({credit.serial}) · {credit.year} · стр. {credit.page}
                    </a>
                    <span className="curator-kind">
                      {KIND[credit.kind] ?? credit.kind}
                      {credit.source.startsWith("curator:") ? " · добавлено куратором" : ""}
                    </span>
                    <span className="author-title">{credit.title ?? "без заголовка"}</span>
                    <span className="curator-byline">Подпись: «{credit.byline}»</span>
                    <button type="button" disabled={busy} onClick={() => void setStatus(credit, credit.status === "hidden" ? "auto" : "hidden")}>
                      {credit.status === "hidden" ? "Вернуть" : "Скрыть"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
