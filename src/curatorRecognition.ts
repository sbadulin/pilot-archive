// Curator-only: recognizing bylines of a submission and publishing the search index.
// Loaded on demand in the admin build only; the public site never downloads it.
import {openPdf} from "./pdf";
import {printedPages} from "./readerLayout";
import {loadRecognizedSheets, loadSubmissionPdf, recognizeSubmissionSheet, type Submission} from "./ingestionClient";
import {publishSearchIndex} from "./authorsPublish";

export {publishSearchIndex};

export type RecognitionResult = {names: number; sheets: number; failed: number[]; stopped: string; reason: string};

const ROUNDS = 3;
const ROUND_PAUSE_MS = 5000;

// Bylines are recognized before approval, while the PDF is still in the private bucket.
// A retry sends only the sheets that have no recognition yet.
export async function recognizeIssue(
  item: Submission,
  onProgress: (done: number, total: number, round: number) => void,
  onlyMissing = false,
): Promise<RecognitionResult> {
  const recognized = new Set(onlyMissing ? await loadRecognizedSheets(item.id) : []);
  const pdf = await openPdf(await loadSubmissionPdf(item.id));
  try {
    const areas: number[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const viewport = (await pdf.getPage(n)).getViewport({scale: 1});
      areas.push(viewport.width * viewport.height);
    }
    const typical = [...areas].sort((a, b) => a - b)[Math.floor(areas.length / 2)];
    const printed = printedPages(
      pdf.numPages,
      areas.flatMap((area, index) => (area > typical * 1.3 ? [index + 1] : [])),
    );
    let pending = Array.from({length: pdf.numPages}, (_, index) => index + 1).filter(
      (sheet) => !recognized.has(sheet),
    );
    const total = pending.length;
    const errors = new Map<number, string>();
    let stopped = "";
    let names = 0;
    const recognizeSheet = async (sheet: number) => {
      const page = await pdf.getPage(sheet);
      // 150 dpi: enough for bylines, small enough to send.
      const viewport = page.getViewport({scale: 150 / 72});
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({canvas, viewport}).promise;
      const jpeg = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
      canvas.width = 0;
      canvas.height = 0;
      // Await first: `names += await …` would read names before the wait and lose parallel updates.
      const result = await recognizeSubmissionSheet(item.id, sheet, printed.first(sheet), jpeg);
      names += result.credits;
    };
    // Models fail now and then under load, so failed sheets get two more rounds,
    // after a pause and with fewer requests at once.
    for (let round = 0; round < ROUNDS && pending.length && !stopped; round++) {
      if (round > 0) await new Promise((resolve) => setTimeout(resolve, ROUND_PAUSE_MS));
      const queue = [...pending];
      const failed: number[] = [];
      let done = 0;
      onProgress(total - pending.length, total, round);
      const worker = async () => {
        for (let sheet = queue.shift(); sheet; sheet = queue.shift()) {
          try {
            await recognizeSheet(sheet);
            errors.delete(sheet);
            done++;
          } catch (error) {
            failed.push(sheet);
            errors.set(sheet, (error as Error).message);
            // Out of AI Gateway balance: every other sheet would fail the same way.
            if ((error as Error).message.startsWith("Баланс")) {
              stopped = (error as Error).message;
              failed.push(...queue.splice(0));
            }
          }
          onProgress(total - pending.length + done, total, round);
        }
      };
      await Promise.all(Array.from({length: round === 0 ? 3 : 2}, worker));
      pending = failed;
    }
    const reasons = [...new Set(errors.values())];
    return {names, sheets: total, failed: pending.sort((a, b) => a - b), stopped, reason: reasons[0] ?? ""};
  } finally {
    void pdf.destroy();
  }
}

export const recognitionSummary = (result: RecognitionResult) =>
  result.stopped
    ? result.stopped
    : `Найдено подписей: ${result.names} на ${result.sheets} листах${result.failed.length ? `; не распознаны листы ${result.failed.join(", ")} (${result.reason}) — нажмите «Распознать подписи», чтобы повторить` : ""}.`;

type Report = {progress: (text: string) => void; error: (text: string) => void};

const progressOf = (item: Submission, report: Report) => (done: number, total: number, round: number) =>
  report.progress(`Распознаём подписи в № ${item.number}: ${done} из ${total}${round ? ` (повтор ${round})` : ""}`);

const publishOrWarn = (report: Report, prefix: string) =>
  publishSearchIndex().catch((error: Error) =>
    report.error(`${prefix} (${error.message}). Нажмите «Обновить поиск на сайте» на странице «Имена авторов».`),
  );

// Recognize the sheets of an approved issue that have no recognition yet (all of them for a fresh
// approval, the missed ones on a retry), then republish the site search.
export async function retryRecognition(item: Submission, report: Report): Promise<string> {
  const result = await recognizeIssue(item, progressOf(item, report), true);
  if (result.sheets === 0) return `В № ${item.number} все листы уже распознаны.`;
  const message = `№ ${item.number}: ${recognitionSummary(result)}`;
  report.progress(message);
  // Nothing new to publish when recognition stopped or found nothing.
  if (!result.stopped && result.names > 0) await publishOrWarn(report, "Подписи сохранены, но поиск на сайте не обновился");
  return message;
}
