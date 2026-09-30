import {useCallback, useEffect, useId, useMemo, useState} from "react";
import {ArrowLeft, Search} from "lucide-react";
import {jsonRequest} from "./ingestionClient";
import {matchesQuery, MIN_QUERY} from "./authorSearch";

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
};

const KIND: Record<string, string> = {article: "статья", letter: "письмо", pager: "пейджер", photo: "фото", drawing: "рисунок", other: "другое"};

// Curator page: fix misread names, merge spellings, hide wrong credits. Admin build only.
export function CuratorAuthors({onBack}: {onBack: () => void}) {
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
                    <span className="curator-kind">{KIND[credit.kind] ?? credit.kind}</span>
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
