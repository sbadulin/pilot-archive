import {useEffect, useRef, useState} from "react";
import {ArrowLeft, ArrowRight, X} from "lucide-react";
import {drawingThumbUrl, graphicsUrl} from "./config";
import {issueLabel, type Issue} from "./metadata";
import type {GraphicsSite, SiteDrawing} from "./artistGraphics";

// The drawings list is small and the same for every artist: fetched once, on the first card that
// may have drawings. A failure only hides the gallery.
let request: Promise<GraphicsSite | null> | null = null;
const loadGraphics = () =>
  (request ??= fetch(graphicsUrl(), {cache: "no-cache"})
    .then((response) => (response.ok ? (response.json() as Promise<GraphicsSite>) : null))
    .catch(() => null));

const pageHref = (drawing: SiteDrawing) => `/#issue-${drawing.issue}-p${drawing.page}`;

function Where({drawing, issue}: {drawing: SiteDrawing; issue: Issue}) {
  return (
    <span className="drawing-where">
      {issueLabel(issue)} · {issue.dateLabel} · стр. {drawing.page}
    </span>
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
  const drawings = artist?.drawings.filter((drawing) => issues.has(drawing.issue)) ?? [];

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open !== null && !element.open) element.showModal();
    if (open === null && element.open) element.close();
  }, [open]);

  if (!drawings.length) return null;
  const shown = open !== null ? drawings[open] : null;
  const step = (by: number) => setOpen((current) => (current === null ? null : (current + by + drawings.length) % drawings.length));

  return (
    <section className="artist-gallery" aria-label="Рисунки">
      <h4>
        Рисунки <span>{drawings.length}</span>
      </h4>
      <ul>
        {drawings.map((drawing, index) => (
          <li key={drawing.id}>
            <button type="button" className="drawing-card" onClick={() => setOpen(index)}>
              <span className="drawing-frame">
                <img src={drawingThumbUrl(drawing.id)} alt={drawing.title} loading="lazy" decoding="async" />
              </span>
              <span className="drawing-title">{drawing.title}</span>
              <Where drawing={drawing} issue={issues.get(drawing.issue)!} />
            </button>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        className="drawing-view"
        aria-label={shown?.title}
        onClose={() => setOpen(null)}
        onClick={(event) => event.target === event.currentTarget && setOpen(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") step(1);
          if (event.key === "ArrowLeft") step(-1);
        }}
      >
        {shown && (
          <figure>
            <button type="button" className="drawing-close" onClick={() => setOpen(null)} aria-label="Закрыть">
              <X size={22} aria-hidden="true" />
            </button>
            <img src={drawingThumbUrl(shown.id)} alt={shown.title} />
            <figcaption>
              <span className="drawing-title">{shown.title}</span>
              <Where drawing={shown} issue={issues.get(shown.issue)!} />
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
                <a className="primary-button" href={pageHref(shown)} onClick={() => setOpen(null)}>
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
