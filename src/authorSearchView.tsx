import {useEffect, useId, useMemo, useState} from "react";
import {Search} from "lucide-react";
import {authorsIndexUrl} from "./config";
import {MIN_QUERY, searchNames} from "./authorSearch";
import type {Issue} from "./metadata";
import type {IndexName} from "../functions/api/_lib/authorsIndex";

const materialCount = (count: number) => {
  if (count % 10 === 1 && count % 100 !== 11) return `${count} материал`;
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20))
    return `${count} материала`;
  return `${count} материалов`;
};

// Search by the names printed under materials; results link to the page in the reader.
export function AuthorSearch({issues, onClose}: {issues: Issue[]; onClose: () => void}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<IndexName[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<IndexName | null>(null);

  // The index is fetched on first use: most visitors never search.
  useEffect(() => {
    if (index || failed || !query) return;
    void fetch(authorsIndexUrl(), {cache: "no-cache"})
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload) => setIndex(Array.isArray(payload?.names) ? payload.names : []))
      .catch(() => setFailed(true));
  }, [query, index, failed]);

  const byKey = useMemo(
    () => new Map(issues.map((issue) => [`${issue.year}-${issue.number}-${issue.serial}`, issue])),
    [issues],
  );
  // Only issues present in the catalog can be opened, so counts and lists use those alone.
  const visible = useMemo(
    () =>
      index
        ?.map((entry) => ({...entry, credits: entry.credits.filter((credit) => byKey.has(credit.issue))}))
        .filter((entry) => entry.credits.length > 0) ?? null,
    [index, byKey],
  );
  const matches = useMemo(() => (visible && !selected ? searchNames(visible, query) : []), [visible, query, selected]);
  const long = query.trim().length >= MIN_QUERY;
  const credits = selected?.credits ?? [];

  return (
    <section className="author-search" aria-label="Поиск по авторам">
      <label className="visually-hidden" htmlFor={`${listId}-input`}>
        Найти автора
      </label>
      <div className="author-search-field">
        <Search size={20} aria-hidden="true" />
        <input
          id={`${listId}-input`}
          autoFocus
          type="search"
          autoComplete="off"
          placeholder="Имя или псевдоним из подписи, например «Князь Тишины»"
          value={query}
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) setSelected(matches[0]);
            if (event.key === "Escape" && !query) onClose();
          }}
        />
      </div>
      {matches.length > 0 && (
        <ul className="author-suggestions" id={listId} role="listbox">
          {matches.map((entry) => (
            <li key={entry.key + entry.name} role="option" aria-selected={false}>
              <button type="button" onClick={() => setSelected(entry)}>
                <span>{entry.name}</span>
                <span className="author-count">{materialCount(entry.credits.length)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {long && !selected && visible && matches.length === 0 && (
        <p className="author-empty">
          Такой подписи не нашли. Имена берутся из подписей под материалами — попробуйте фамилию или псевдоним.
        </p>
      )}
      {long && failed && <p className="author-empty">Поиск по авторам пока недоступен.</p>}
      {selected && (
        <div className="author-credits">
          <h3>{selected.name}</h3>
          {selected.aliases?.length > 0 && (
            <p className="author-aliases">Также встречается как: {selected.aliases.join(", ")}</p>
          )}
          <ul>
            {credits.map((credit) => {
              const issue = byKey.get(credit.issue)!;
              return (
                <li key={`${credit.issue}-${credit.page}-${credit.title ?? ""}`}>
                  <a href={`#issue-${credit.issue}-p${credit.page}`}>
                    <span className="author-where">
                      № {issue.number} ({issue.serial}) · {issue.dateLabel} · стр. {credit.page}
                    </span>
                    {credit.title && <span className="author-title">{credit.title}</span>}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
