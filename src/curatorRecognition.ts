// Curator-only: recognizing bylines of a submission and publishing the search index.
// Loaded on demand in the admin build only; the public site never downloads it.
import {openPdf} from "./pdf";
import {printedPages} from "./readerLayout";
import {approveSubmission, loadRecognizedSheets, loadSubmissionPdf, recognizeSubmissionSheet, type Submission} from "./ingestionClient";
import {publishSearchIndex} from "./authorsPublish";

export {publishSearchIndex};

export type RecognitionResult = {names: number; sheets: number; failed: number[]; stopped: string};

// Bylines are recognized before approval, while the PDF is still in the private bucket.
// A retry sends only the sheets that have no recognition yet.
export async function recognizeIssue(
  item: Submission,
  onProgress: (done: number, total: number) => void,
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
    const queue = Array.from({length: pdf.numPages}, (_, index) => index + 1).filter(
      (sheet) => !recognized.has(sheet),
    );
    const total = queue.length;
    const failed: number[] = [];
    let stopped = "";
    let done = 0;
    let names = 0;
    onProgress(0, total);
    const worker = async () => {
      for (let sheet = queue.shift(); sheet; sheet = queue.shift()) {
        try {
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
          const result = await recognizeSubmissionSheet(item.id, sheet, printed.first(sheet), jpeg);
          names += result.credits;
        } catch (error) {
          failed.push(sheet);
          // Out of AI Gateway balance: every other sheet would fail the same way.
          if ((error as Error).message.startsWith("Баланс")) {
            stopped = (error as Error).message;
            failed.push(...queue.splice(0));
          }
        }
        done++;
        onProgress(done, total);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return {names, sheets: total, failed: failed.sort((a, b) => a - b), stopped};
  } finally {
    void pdf.destroy();
  }
}

export const recognitionSummary = (result: RecognitionResult) =>
  result.stopped
    ? result.stopped
    : `Найдено подписей: ${result.names} на ${result.sheets} листах${result.failed.length ? `; не распознаны листы ${result.failed.join(", ")} — нажмите «Распознать подписи», чтобы повторить` : ""}.`;

type Report = {progress: (text: string) => void; error: (text: string) => void};

const progressOf = (item: Submission, report: Report) => (done: number, total: number) =>
  report.progress(`Распознаём подписи в № ${item.number}: ${done} из ${total}`);

const publishOrWarn = (report: Report, prefix: string) =>
  publishSearchIndex().catch((error: Error) =>
    report.error(`${prefix} (${error.message}). Нажмите «Обновить поиск на сайте» на странице «Имена авторов».`),
  );

// Approve an issue after recognizing its bylines; a failed recognition never blocks approval.
export async function approveWithRecognition(item: Submission, report: Report): Promise<string> {
  let summary: string;
  try {
    summary = recognitionSummary(await recognizeIssue(item, progressOf(item, report)));
  } catch (error) {
    summary = `Подписи не распознаны (${(error as Error).message}), выпуск одобрен без них.`;
  }
  await approveSubmission(item.id);
  report.progress(`№ ${item.number} одобрен. ${summary}`);
  await publishOrWarn(report, "Поиск на сайте не обновился");
  return `№ ${item.number} одобрен. ${summary}`;
}

// Recognize the sheets an earlier run missed (e.g. when the AI balance ran out).
export async function retryRecognition(item: Submission, report: Report): Promise<string> {
  const result = await recognizeIssue(item, progressOf(item, report), true);
  if (result.sheets === 0) return `В № ${item.number} все листы уже распознаны.`;
  const message = `№ ${item.number}: ${recognitionSummary(result)}`;
  report.progress(message);
  // Nothing new to publish when recognition stopped or found nothing.
  if (!result.stopped && result.names > 0) await publishOrWarn(report, "Подписи сохранены, но поиск на сайте не обновился");
  return message;
}
