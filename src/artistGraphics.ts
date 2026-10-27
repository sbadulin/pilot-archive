// Drawings of the newspaper's artists for the author card (/archive/graphics.json), built by
// scripts/graphics-site.mjs from the graphics catalogue in the cache (graphics/<issue>.json) and the
// hand-kept rules in scripts/graphics-artists.json. The catalogue numbers sheets; links name printed
// pages, so each drawing carries both.
import { normalizeName } from './authorNames.ts';
import { printedPages } from './readerLayout.ts';

// One graphic of the catalogue, as the marking agents write it. box is in pixels of page-NN.jpg.
export type CatalogGraphic = {
  sheet: number;
  box: [number, number, number, number];
  kind: string;
  what: string;
  signature?: string | null;
  veselov?: 'yes' | 'maybe' | 'no';
  crop: string;
};
export type ArtistRule = { name: string; auto?: 'veselov'; include?: string[]; exclude?: string[] };
// reprints: ids of one drawing printed several times; the card shows it once, from the first print.
export type GraphicsRules = { artists: ArtistRule[]; reprints?: string[][]; titles?: Record<string, string> };

// box: fractions of the sheet (x0, y0, x1, y1), for a highlight that does not depend on scan size.
// prints: every printing of the drawing, oldest first, this one included.
export type SitePrint = { issue: string; page: number };
export type SiteDrawing = { id: string; issue: string; sheet: number; page: number; title: string; box: [number, number, number, number]; prints: SitePrint[] };
export type SiteArtist = { name: string; key: string; drawings: SiteDrawing[] };
export type GraphicsSite = { version: 1; artists: SiteArtist[] };

export type CatalogIssue = { issue: string; graphics: CatalogGraphic[]; sheets: number; spreads: number[]; size: (sheet: number) => [number, number] };

export const drawingId = (graphic: CatalogGraphic) => graphic.crop.replace(/^.*\//, '').replace(/\.jpg$/, '');

// The catalogue's own description, when the rules have no title for it, without the cataloguer's
// kind prefix: «Карандашный рисунок: девушка с зонтом» → «Девушка с зонтом».
export const fallbackTitle = (what: string) => {
  const text = what.trim().replace(/^(?:[\p{L} ]{0,25}?(?:рисунок|графика|иллюстрация|шарж|карикатура|заставка|виньетка)[\p{L} ]{0,25}?):\s*/iu, '');
  // The first letter, even after an opening quote: «шикарная блондинка» → «Шикарная блондинка».
  return text.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase('ru'));
};

export function buildGraphicsSite(issues: CatalogIssue[], rules: GraphicsRules): GraphicsSite {
  const artists = rules.artists.map((rule) => {
    const include = new Set(rule.include ?? []);
    const exclude = new Set(rule.exclude ?? []);
    const drawings: SiteDrawing[] = [];
    for (const issue of issues) {
      const numbering = printedPages(issue.sheets, issue.spreads);
      for (const graphic of issue.graphics) {
        const id = drawingId(graphic);
        const marked = rule.auto === 'veselov' && graphic.veselov === 'yes';
        if (exclude.has(id) || !(marked || include.has(id))) continue;
        const [width, height] = issue.size(graphic.sheet);
        const [x0, y0, x1, y1] = graphic.box;
        const fraction = (value: number, of: number) => Math.round((Math.min(Math.max(value, 0), of) / of) * 10000) / 10000;
        drawings.push({
          id,
          issue: issue.issue,
          sheet: graphic.sheet,
          page: numbering.first(graphic.sheet),
          title: rules.titles?.[id] ?? fallbackTitle(graphic.what),
          box: [fraction(x0, width), fraction(y0, height), fraction(x1, width), fraction(y1, height)],
          prints: [{ issue: issue.issue, page: numbering.first(graphic.sheet) }],
        });
      }
    }
    drawings.sort((a, b) => a.issue.localeCompare(b.issue) || a.sheet - b.sheet || a.box[1] - b.box[1]);
    // A reprint joins the first printing of its group: one card, every printing linked under it.
    const groupOf = new Map((rules.reprints ?? []).flatMap((group, index) => group.map((id) => [id, index] as const)));
    const first = new Map<number, SiteDrawing>();
    const shown = drawings.filter((drawing) => {
      const group = groupOf.get(drawing.id);
      if (group === undefined) return true;
      const head = first.get(group);
      if (!head) return first.set(group, drawing), true;
      head.prints.push(...drawing.prints);
      return false;
    });
    return { name: rule.name, key: normalizeName(rule.name), drawings: shown };
  });
  return { version: 1, artists: artists.filter((artist) => artist.drawings.length) };
}
