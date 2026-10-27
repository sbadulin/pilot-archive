// Sheets of an issue PDF scanned as two-page spreads, by the reader's rule (src/app.tsx): page area
// over 1.3× the median. Recognition and the graphics catalogue number sheets, the reader's links name
// printed pages (src/readerLayout.ts printedPages), so the data published for links needs both.
import { execFileSync } from 'node:child_process';

export function spreadSheets(pdfPath) {
  const info = execFileSync('pdfinfo', ['-f', '1', '-l', '9999', pdfPath], { encoding: 'utf8' });
  const areas = [...info.matchAll(/^Page\s+\d+\s+size:\s+([\d.]+)\s+x\s+([\d.]+)/gm)].map((match) => Number(match[1]) * Number(match[2]));
  const typical = [...areas].sort((a, b) => a - b)[Math.floor(areas.length / 2)] ?? 0;
  return areas.flatMap((area, index) => (area > typical * 1.3 ? [index + 1] : []));
}
