import {useEffect, useRef, useState} from "react";
import {ArrowLeft, ArrowRight, X} from "lucide-react";
import {drawingThumbUrl, graphicsUrl} from "./config";
import {issueLabel, type Issue} from "./metadata";
import type {GraphicsSite, SiteDrawing, SitePrint} from "./artistGraphics";

// The drawings list is small and the same for every artist: fetched once, on the first card that
// may have drawings. A failure only hides the gallery.
let request: Promise<GraphicsSite | null> | null = null;
const loadGraphics = () =>
  (request ??= fetch(graphicsUrl(), {cache: "no-cache"})
    .then((response) => (response.ok ? (response.json() as Promise<GraphicsSite>) : null))
    .catch(() => null));

const pageHref = (print: SitePrint) => `/#issue-${print.issue}-p${print.page}`;
// «2 раза», «5 раз», «22 раза».
const times = (count: number) =>
  `${count} ${count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? "раза" : "раз"}`;

// Every printing of a drawing, each a link to its page: a reprint is listed, not shown again. Under
// a thumbnail it is short («№ 02 · стр. 15», the date in the tooltip); in the large view, in full.
// Under a thumbnail a reprinted drawing shows its first printing and «ещё N» for the rest.
function Prints({prints, issues, full = false, onOpen}: {prints: SitePrint[]; issues: Map<string, Issue>; full?: boolean; onOpen?: () => void}) {
  const [more, setMore] = useState(false);
  const listed = full || more ? prints : prints.slice(0, 1);
  return (
    <ul className="drawing-prints">
      {listed.map((print) => {
        const issue = issues.get(print.issue)!;
        const label = full ? issueLabel(issue) : issueLabel(issue).replace(/\s*\(\d+\)$/, "");
        return (
          <li key={`${print.issue}-${print.page}`}>
            <a href={pageHref(print)} onClick={onOpen} title={full ? undefined : `${issueLabel(issue)} · ${issue.dateLabel}`}>
              {full ? `${label} · ${issue.dateLabel} · стр. ${print.page}` : `${label} · стр. ${print.page}`}
            </a>
          </li>
        );
      })}
      {!full && prints.length > 1 && (
        <li>
          <button type="button" className="drawing-more" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? "свернуть" : `ещё ${prints.length - 1}`}
          </button>
        </li>
      )}
    </ul>
  );
}

/** «Рисунки» of an artist in the author card: thumbnails, and a larger view with the way to the page. */
export function ArtistGallery({keys, issues}: {keys: string[]; issues: Map<string, Issue>}) {
  const [site, setSite] = useState<GraphicsSite | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let alive = true;
    void loadGraphics().then((loaded) => alive && setSite(loaded));
    return () => {
      alive = false;
    };
  }, []);

  const artist = site?.artists.find((candidate) => keys.includes(candidate.key));
  // Only issues in the catalog can be opened.
  const drawings: SiteDrawing[] = (artist?.drawings ?? [])
    .map((drawing) => ({...drawing, prints: drawing.prints.filter((print) => issues.has(print.issue))}))
    .filter((drawing) => drawing.prints.length > 0);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open !== null && !element.open) element.showModal();
    if (open === null && element.open) element.close();
  }, [open]);

  if (!drawings.length) return null;
  const shown = open !== null ? drawings[open] : null;
  const step = (by: number) => setOpen((current) => (current === null ? null : (current + by + drawings.length) % drawings.length));
  const close = () => setOpen(null);

  return (
    <section className="artist-gallery" aria-label="Рисунки">
      <h4>
        Рисунки <span>{drawings.length}</span>
      </h4>
      <ul className="drawing-grid">
        {drawings.map((drawing, index) => (
          <li key={drawing.id}>
            <button type="button" className="drawing-card" onClick={() => setOpen(index)}>
              <span className="drawing-frame">
                <img src={drawingThumbUrl(drawing.id)} alt={drawing.title} loading="lazy" decoding="async" />
              </span>
              <span className="drawing-title">{drawing.title}</span>
            </button>
            <Prints prints={drawing.prints} issues={issues} />
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        className="drawing-view"
        aria-label={shown?.title}
        onClose={close}
        onClick={(event) => event.target === event.currentTarget && close()}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") step(1);
          if (event.key === "ArrowLeft") step(-1);
        }}
      >
        {shown && (
          <figure>
            <button type="button" className="drawing-close" onClick={close} aria-label="Закрыть">
              <X size={22} aria-hidden="true" />
            </button>
            <img src={drawingThumbUrl(shown.id)} alt={shown.title} />
            <figcaption>
              <span className="drawing-title">{shown.title}</span>
              {shown.prints.length > 1 && <span className="drawing-reprinted">Печатался {times(shown.prints.length)}:</span>}
              <Prints prints={shown.prints} issues={issues} full onOpen={close} />
              <span className="drawing-actions">
                {drawings.length > 1 && (
                  <>
                    <button type="button" className="tool-button" onClick={() => step(-1)} aria-label="Предыдущий рисунок">
                      <ArrowLeft size={18} aria-hidden="true" />
                    </button>
                    <span className="drawing-count">
                      {open! + 1} из {drawings.length}
                    </span>
                    <button type="button" className="tool-button" onClick={() => step(1)} aria-label="Следующий рисунок">
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  </>
                )}
                <a className="primary-button" href={pageHref(shown.prints[0])} onClick={close}>
                  Открыть страницу газеты
                </a>
              </span>
            </figcaption>
          </figure>
        )}
      </dialog>
    </section>
  );
}
