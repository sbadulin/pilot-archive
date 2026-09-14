'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Download, FileUp, Grid2X2, Maximize, Minus, Plus, RotateCw } from 'lucide-react';
import { adminUrl, isPublicSite, manifestUrl } from './config';
import { groupSpreads } from './readerLayout';
import { Checkbox } from './checkbox';
import { issues as staticIssues, issuePdfUrl, scanUrl, parseFilename, validateMetadata, type Issue } from './metadata';
import { approveSubmission, loadSubmissionPdf, loadSubmissionQueue, rejectSubmission, sendSubmission, type Submission } from './ingestionClient';

type Screen = { kind: 'archive' } | { kind: 'reader'; id: number | string; page?: number } | { kind: 'upload' };
type Draft = { file: File; pdf: PDFDocumentProxy; thumbnails: string[]; largePages: number[] };
const years = Array.from({ length: 12 }, (_, i) => 1996 + i);
const logoByYear: Record<number, string> = {};
const logoForYear = (year: number) => logoByYear[year] ?? '/PilotBW.svg';
const yearRoute = (year: number) => `#year-${year}`;
const issueRoute = (issue: Issue) => `#issue-${issue.year}-${issue.number}-${issue.serial}`;

const issueCountLabel = (count: number) => {
  if (count % 10 === 1 && count % 100 !== 11) return `${count} выпуск`;
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) return `${count} выпуска`;
  return `${count} выпусков`;
};

function Brand({ small = false, year = 2000 }: { small?: boolean; year?: number }) {
  return <span className={small ? 'brand brand-small' : 'brand'}><img src={logoForYear(year)} alt="Первый Пилот" /></span>;
}

function PdfCanvas({ pdf, page, width = 900, rotation = 0 }: { pdf: PDFDocumentProxy; page: number; width?: number; rotation?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [ratio, setRatio] = useState(0.707);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '600px' });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setLoading(true);
    setError('');
    const target = canvas.current;
    if (!target) return;
    if (!near) { target.width = 0; target.height = 0; return; }
    const render = async () => {
      try {
        const sheet = await pdf.getPage(page);
        if (cancelled) return;
        const base = sheet.getViewport({ scale: 1, rotation: (sheet.rotate + rotation) % 360 });
        const viewport = sheet.getViewport({ scale: Math.min(width * (window.devicePixelRatio || 1), 3000) / base.width, rotation: (sheet.rotate + rotation) % 360 });
        setRatio(viewport.width / viewport.height);
        target.width = viewport.width;
        target.height = viewport.height;
        task = sheet.render({ canvas: target, viewport });
        await task.promise;
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled && (e as Error).name !== 'RenderingCancelledException') {
          setError('Не удалось показать страницу. Выберите её ещё раз.');
          setLoading(false);
        }
      }
    };
    void render();
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, page, width, rotation, near]);
  return <div ref={container} className="canvas-wrap" style={{ width, aspectRatio: ratio }} aria-busy={loading}>
    {loading && <div className="render-status" role="status">Открываем страницу…</div>}
    {error && <p role="alert">{error}</p>}
    <canvas ref={canvas} aria-label={`Страница ${page}`} style={{ width: '100%', height: 'auto' }} />
  </div>;
}

function dataUrlToBlob(value: string) {
  const [header, data] = value.split(',', 2);
  const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
  return new Blob([bytes], { type: header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg' });
}

async function openPdf(data: ArrayBuffer | string) {
  const engine = await import('pdfjs-dist');
  engine.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  const task = engine.getDocument({ ...(typeof data === 'string' ? { url: data } : { data }), cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/', disableAutoFetch: true, disableStream: true });
  task.onPassword = () => { void task.destroy(); };
  return task.promise;
}

function Reader({ issue, onBack, initialPage = 1 }: { issue: Issue; onBack: () => void; initialPage?: number }) {
  const [page, setPage] = useState(Math.max(1, Math.min(issue.pages, initialPage)));
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [showPages, setShowPages] = useState(true);
  const [viewMode, setViewMode] = useState<'sheet' | 'continuous' | 'spreads'>('sheet');
  const [largePages, setLargePages] = useState<number[]>([]);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState(false);
  const [baseWidth, setBaseWidth] = useState(740);
  const viewport = useRef<HTMLDivElement>(null);
  const pageNodes = useRef<Record<number, HTMLElement | null>>({});
  const goPage = useCallback((next: number) => { const target = Math.max(1, Math.min(issue.pages, next)); setPage(target); setRotation(0); window.history.replaceState(null, '', `${issueRoute(issue)}-p${target}`); if (viewMode === 'sheet') viewport.current?.scrollTo(0, 0); else requestAnimationFrame(() => pageNodes.current[target]?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }, [issue, viewMode]);
  const spreadGroups = groupSpreads(issue.pages, largePages);
  useEffect(() => {
    let disposed = false;
    let document: PDFDocumentProxy | undefined;
    void openPdf(issuePdfUrl(issue)).then(async result => {
      document = result;
      if (disposed) void result.destroy(); else {
        setPdf(result);
        const areas: number[] = [];
        for (let n = 1; n <= result.numPages; n++) {
          const sheet = await result.getPage(n);
          const viewport = sheet.getViewport({ scale: 1 });
          areas.push(viewport.width * viewport.height);
        }
        const sorted = [...areas].sort((a, b) => a - b);
        const typical = sorted[Math.floor(sorted.length / 2)] || 0;
        const detected = areas.flatMap((area, index) => area > typical * 1.3 ? [index + 1] : []);
        setLargePages(detected);
      }
    }).catch(() => { if (!disposed) setPdfError(true); });
    return () => { disposed = true; void document?.destroy(); };
  }, [issue.id]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setBaseWidth(Math.max(240, Math.min(920, element.clientWidth - 48))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); goPage(page + 1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); goPage(page - 1); }
      if (event.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, goPage, onBack]);
  return <main className="reader">
    <header className="reader-header">
      <button className="text-button" onClick={onBack}><ArrowLeft size={19} /><span>К выпускам</span></button>
      <div className="reader-title"><b>№ {issue.number} <span>({issue.serial})</span></b><span>{issue.dateLabel}</span></div>
      <a className="text-button download" href={issuePdfUrl(issue)} download={issue.filename}><Download size={18} /><span>Скачать PDF</span></a>
    </header>
    <div className="reader-toolbar">
      <button className={`tool-button ${showPages ? 'pressed' : ''}`} aria-label="Показать миниатюры страниц" aria-pressed={showPages} onClick={() => setShowPages(!showPages)}><Grid2X2 size={18} /></button>
      <div className="page-control">
        <button className="tool-button" aria-label="Предыдущая страница" disabled={page === 1} onClick={() => goPage(page - 1)}><ChevronLeft size={20} /></button>
        <label>Страница <input aria-label="Номер страницы" type="number" min={1} max={issue.pages} value={page} onChange={e => { if (e.target.value) goPage(Number(e.target.value)); }} /> из {issue.pages}</label>
        <button className="tool-button" aria-label="Следующая страница" disabled={page === issue.pages} onClick={() => goPage(page + 1)}><ChevronRight size={20} /></button>
      </div>
      <span className="toolbar-rule" />
      <div className="zoom-control">
        <button className="tool-button" aria-label="Уменьшить" disabled={zoom <= 50} onClick={() => setZoom(v => Math.max(50, v - 25))}><Minus size={18} /></button>
        <output aria-label="Масштаб">{zoom}%</output>
        <button className="tool-button" aria-label="Увеличить" disabled={zoom >= 300} onClick={() => setZoom(v => Math.min(300, v + 25))}><Plus size={18} /></button>
      </div>
      <button className="tool-button" aria-label="По ширине" title="По ширине" onClick={() => { setZoom(100); setRotation(0); }}><Maximize size={18} /></button>
      <button className="tool-button" aria-label="Повернуть страницу" title="Повернуть страницу" onClick={() => setRotation(v => (v + 90) % 360)}><RotateCw size={18} /></button>
      <div className="view-mode" role="group" aria-label="Режим просмотра"><button className={viewMode === 'sheet' ? 'active' : ''} onClick={() => setViewMode('sheet')}>Страница</button><button className={viewMode === 'continuous' ? 'active' : ''} onClick={() => setViewMode('continuous')}>Лента</button><button className={viewMode === 'spreads' ? 'active' : ''} onClick={() => setViewMode('spreads')}>Развороты</button></div>
    </div>
    <div className="reader-body">
      {showPages && <nav className="thumbnails" aria-label="Страницы выпуска">{Array.from({ length: issue.pages }, (_, i) => i + 1).map(n => <button key={n} className={`thumbnail ${page === n ? 'selected' : ''}`} aria-current={page === n ? 'page' : undefined} onClick={() => goPage(n)}>{pdf ? <PdfCanvas pdf={pdf} page={n} width={110} /> : <span className="page-placeholder">{n}</span>}<span>{n === 1 ? '1 · Обложка' : `Страница ${n}`}</span></button>)}</nav>}
      <div className={`sheet-viewport view-${viewMode}`} ref={viewport}>
        {viewMode === 'sheet' && <><div className="sheet-info" role="status">{largePages.includes(page) ? 'Увеличенная страница' : page === 1 ? 'Обложка' : `Страница ${page}`}<span>Исходный PDF</span></div><div className="sheet-inner" style={{ minWidth: baseWidth * zoom / 100 + 48 }}>{pdf ? <PdfCanvas pdf={pdf} page={page} width={baseWidth * zoom / 100} rotation={rotation} /> : <p className="pdf-loading">Открываем PDF…</p>}</div></>}
        {viewMode === 'continuous' && <div className="continuous-pages">{Array.from({ length: issue.pages }, (_, index) => index + 1).map(number => <figure ref={node => { pageNodes.current[number] = node; }} className={largePages.includes(number) ? 'large-page' : ''} key={number}><figcaption>{largePages.includes(number) ? `Страница ${number} · увеличенная` : `Страница ${number}`}</figcaption>{pdf ? <PdfCanvas pdf={pdf} page={number} width={baseWidth * zoom / 100} /> : <p className="pdf-loading">Открываем PDF…</p>}</figure>)}</div>}
        {viewMode === 'spreads' && <div className="spread-pages">{spreadGroups.map(pages => <div ref={node => { pages.forEach(number => { pageNodes.current[number] = node; }); }} className={`spread ${pages.length === 1 ? 'single' : ''} ${pages.length === 1 && largePages.includes(pages[0]) ? 'large' : ''}`} key={pages[0]}>{pages.map(sheet => pdf ? <PdfCanvas key={sheet} pdf={pdf} page={sheet} width={baseWidth * zoom / (pages.length === 1 && largePages.includes(pages[0]) ? 100 : 200)} /> : <p key={sheet} className="pdf-loading">Открываем PDF…</p>)}</div>)}</div>}
        {pdfError && <p className="reader-note" role="status">Не удалось открыть PDF. Попробуйте обновить страницу или скачать файл.</p>}
      </div>
    </div>
    <footer className="reader-footer"><span>{issue.pages} страниц в PDF.</span><span>← → листать <span className="shortcut">Esc закрыть</span></span></footer>
  </main>;
}

function Upload({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [metadata, setMetadata] = useState({ date: '', number: '', serial: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [page, setPage] = useState(1);
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  const [submissionMessage, setSubmissionMessage] = useState('');
  const [queue, setQueue] = useState<Submission[] | null>(null);
  const [isCurator] = useState(() => window.location.hash.includes('role=curator'));
  const [queueError, setQueueError] = useState('');
  const [preview, setPreview] = useState<{ item: Submission; pdf: PDFDocumentProxy; thumbnails: string[] } | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const run = useRef(0);
  useEffect(() => () => { run.current++; void draftRef.current?.pdf.destroy(); }, []);
  const loadFile = async (file: File) => {
    const current = ++run.current;
    setError(''); setDone(false); setConfirmed(false);
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Выберите файл PDF. Изображения и другие файлы сюда не подходят.'); return; }
    if (file.size > 50 * 1024 * 1024) { setError('Файл больше 50 МБ. Выберите PDF меньшего размера.'); return; }
    if (!file.size) { setError('Этот файл пустой. Выберите другой PDF.'); return; }
    setBusy('Открываем PDF…');
    let pdf: PDFDocumentProxy | undefined;
    try {
      pdf = await openPdf(await file.arrayBuffer());
      if (current !== run.current) { void pdf.destroy(); return; }
      if (pdf.numPages > 100) throw new Error('too-many-pages');
      const thumbnails: string[] = [];
      const dimensions: number[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        if (current !== run.current) { void pdf.destroy(); return; }
        setBusy(`Готовим страницы: ${n} из ${pdf.numPages}`);
        const sheet = await pdf.getPage(n);
        const base = sheet.getViewport({ scale: 1 });
        dimensions.push(base.width * base.height);
        const viewport = sheet.getViewport({ scale: 350 / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await sheet.render({ canvas, viewport }).promise;
        thumbnails.push(canvas.toDataURL('image/jpeg', 0.82));
        canvas.width = 0; canvas.height = 0;
      }
      if (current !== run.current) { void pdf.destroy(); return; }
      const typical = [...dimensions].sort((a, b) => a - b)[Math.floor(dimensions.length / 2)];
      const next = { file, pdf, thumbnails, largePages: dimensions.flatMap((size, index) => size > typical * 1.3 ? [index + 1] : []) };
      void draftRef.current?.pdf.destroy();
      draftRef.current = next;
      setDraft(next); setMetadata(parseFilename(file.name)); setPage(1); setStep(2);
    } catch (e) {
      void pdf?.destroy();
      if (current === run.current) setError((e as Error).message === 'too-many-pages' ? 'Можно проверить PDF до 100 страниц.' : 'Не удалось открыть PDF. Проверьте, что файл не повреждён и не защищён паролем, или выберите другой.');
    } finally { if (current === run.current) setBusy(''); }
  };
  const loadExample = async () => {
    setError(''); setBusy('Открываем первый выпуск…');
    try {
      const result = await fetch(issuePdfUrl(staticIssues[0]));
      if (!result.ok) throw new Error('download');
      await loadFile(new File([await result.blob()], staticIssues[0].filename, { type: 'application/pdf' }));
    } catch { setBusy(''); setError('Пример не загрузился. Выберите PDF с вашего устройства.'); }
  };
  const duplicate = staticIssues.find(issue => issue.date === metadata.date && Number(issue.number) === Number(metadata.number));
  const submitForReview = async () => {
    if (!draft) return;
    setSending(true); setSubmissionMessage('');
    try {
      await sendSubmission(draft.file, { year: Number(metadata.date.slice(0, 4)), number: metadata.number, serial: metadata.serial, date: metadata.date, dateLabel: new Date(`${metadata.date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }), pages: draft.pdf.numPages }, draft.thumbnails[0] ? dataUrlToBlob(draft.thumbnails[0]) : undefined);
      setSubmissionMessage('Заявка отправлена куратору. Выпуск появится в архиве после проверки.');
      setDone(true);
      if (isCurator) void loadSubmissionQueue().then(result => setQueue(result.submissions)).catch(() => undefined);
    } catch (error) {
      setError((error as Error).message);
    } finally { setSending(false); }
  };
  const refreshQueue = () => { void loadSubmissionQueue().then(result => { setQueue(result.submissions); setQueueError(''); }).catch(error => setQueueError(error.message)); };
  const openPreview = async (item: Submission) => {
    setPreviewBusy(true); setPreviewError(''); setPreview(null);
    try {
      const pdf = await openPdf(await loadSubmissionPdf(item.id));
      const thumbnails: string[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const sheet = await pdf.getPage(n);
        const base = sheet.getViewport({ scale: 1 });
        const viewport = sheet.getViewport({ scale: 180 / base.width });
        const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
        await sheet.render({ canvas, viewport }).promise;
        thumbnails.push(canvas.toDataURL('image/jpeg', 0.8)); canvas.width = 0; canvas.height = 0;
      }
      setPreview({ item, pdf, thumbnails }); setPreviewPage(1);
    } catch (error) { setPreviewError((error as Error).message); }
    finally { setPreviewBusy(false); }
  };
  const closePreview = () => { void preview?.pdf.destroy(); setPreview(null); };
  const moderate = async (item: Submission, action: 'approve' | 'reject') => {
    if (action === 'approve') await approveSubmission(item.id);
    else await rejectSubmission(item.id, window.prompt('Причина отклонения') ?? 'Нужно уточнить данные выпуска.');
    refreshQueue();
  };
  return <main id="main" className="upload-page shell">
    <button className="text-button back-link" onClick={onBack}><ArrowLeft size={18} />К архиву</button>
    <div className="upload-heading"><div><p className="eyebrow">Пополняем архив вместе</p><h1>Добавить выпуск</h1></div></div>
    <p className="upload-intro">Войдите перед отправкой, затем выберите PDF, сверьте обложку и проверьте страницы. После отправки файл попадёт куратору на проверку.</p><div className="button-row access-actions"><a className="outline-button" href="/api/admin/login?return=%2F%23add">Войти</a>{isCurator && <button className="outline-button" type="button" onClick={refreshQueue}>Показать очередь куратору</button>}</div>
    <ol className="steps" aria-label="Шаги добавления">{['Выбрать PDF', 'Проверить данные', 'Посмотреть страницы'].map((title, i) => <li key={title} className={step === i + 1 ? 'active' : step > i + 1 || done ? 'complete' : ''} aria-current={step === i + 1 ? 'step' : undefined}><span>{step > i + 1 || done ? <Check size={16} /> : i + 1}</span>{title}</li>)}</ol>
    {error && <div className="form-error" role="alert">{error}</div>}
    {busy && <div className="loading-message" role="status"><span className="loading-dot" />{busy}</div>}
    {done && draft ? <section className="completion" aria-live="polite"><div className="completion-symbol"><Check size={38} /></div><h2>Заявка отправлена</h2><p>№ {metadata.number}{metadata.serial && ` (${metadata.serial})`} от {new Date(`${metadata.date}T12:00:00`).toLocaleDateString('ru-RU')}. Страниц: {draft.pdf.numPages}.</p><p>{submissionMessage || 'Выпуск передан куратору. До проверки он не появится в публичном архиве.'}</p><div className="button-row"><button className="primary-button" onClick={onBack}>Вернуться к архиву<ArrowRight size={18} /></button><button className="outline-button" onClick={() => { setDone(false); setStep(3); }}>Посмотреть ещё раз</button></div></section> : <>
    {step === 1 && <section className="upload-start"><div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); if (busy) return; if (e.dataTransfer.files.length !== 1) { setError('Добавляйте по одному PDF за раз.'); return; } void loadFile(e.dataTransfer.files[0]); }}><FileUp size={42} strokeWidth={1.3} /><h2>Перетащите PDF сюда</h2><p>или выберите его на вашем устройстве</p><button className="primary-button" disabled={!!busy} onClick={() => input.current?.click()}>Выбрать PDF<Plus size={18} /></button><span className="muted">Один файл, до 50 МБ</span><input ref={input} type="file" accept="application/pdf,.pdf" className="visually-hidden" tabIndex={-1} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void loadFile(file); }} /></div><aside className="upload-help"><span className="black-label">Под рукой</span><h3>Весь выпуск одним файлом</h3><p>Подойдёт PDF со сканами или исходный PDF из редакции.</p><p>Большие страницы оставьте в исходном размере.</p><div className="try-example"><h3>Сначала попробовать?</h3><p>Пройдите шаги на выпуске от 5 января 2000 года.</p><button className="underlined-button" disabled={!!busy} onClick={() => void loadExample()}>Открыть пример<ArrowRight size={16} /></button></div></aside></section>}
    {step === 2 && draft && <section className="metadata-step"><div className="cover-check"><img src={draft.thumbnails[0]} alt="Первая страница добавленного PDF для проверки даты и номера" /><span>Обложка загруженного файла</span></div><form className="metadata-form" onSubmit={e => { e.preventDefault(); const message = validateMetadata(metadata.date, metadata.number, metadata.serial); setError(message); if (!message) { setStep(3); setConfirmed(false); } }}><span className="black-label">Сверьте с обложкой</span><h2>Всё верно?</h2><p>Если дата и номер были в имени файла, мы подставили их. Проверьте и при необходимости исправьте.</p><label>Дата выпуска<input type="date" required min="1996-01-01" max="2007-12-31" value={metadata.date} onChange={e => setMetadata({ ...metadata, date: e.target.value })} /></label><div className="field-pair"><label>Номер выпуска<input required inputMode="numeric" placeholder="01" maxLength={3} value={metadata.number} onChange={e => setMetadata({ ...metadata, number: e.target.value })} /></label><label>Сквозной номер<input inputMode="numeric" placeholder="0066" maxLength={5} value={metadata.serial} onChange={e => setMetadata({ ...metadata, serial: e.target.value })} /><small>В скобках, если указан</small></label></div><div className="file-summary"><FileUp size={22} /><div><b>{draft.file.name}</b><span>{(draft.file.size / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ · Страниц: {draft.pdf.numPages}</span></div></div>{duplicate && <p className="notice">Этот выпуск уже есть в архиве. Вы можете продолжить проверку, копия в архив не добавится.</p>}<div className="button-row"><button className="primary-button" type="submit">К просмотру страниц<ArrowRight size={18} /></button><button className="text-button" type="button" onClick={() => { setStep(1); setError(''); }}>Другой файл</button></div></form></section>}
    {step === 3 && draft && <section className="review-step"><div className="review-topline"><div><h2>Проверьте страницы</h2><p>Скан читается, страницы идут по порядку и ничего не обрезано.</p></div><span className="sheet-count">{page} / {draft.pdf.numPages}</span></div>{draft.largePages.length > 0 && <p className="notice">Увеличенный размер у страниц: {draft.largePages.join(', ')}. Это допустимо, проверьте, что они целиком попали в скан.</p>}<div className="review-workspace"><nav className="review-thumbnails" aria-label="Страницы добавленного PDF">{draft.thumbnails.map((src, index) => <button key={index} className={`thumbnail ${page === index + 1 ? 'selected' : ''}`} aria-label={`Посмотреть страницу ${index + 1}`} aria-current={page === index + 1 ? 'page' : undefined} onClick={() => setPage(index + 1)}><img src={src} alt="" /><span>{index + 1}{draft.largePages.includes(index + 1) ? ' · большой' : ''}</span></button>)}</nav><div className="review-canvas"><PdfCanvas pdf={draft.pdf} page={page} width={700} /></div></div><div className="review-pagination"><button className="outline-button" disabled={page <= 1} onClick={() => setPage(v => v - 1)}><ChevronLeft size={18} />Предыдущий</button><span>Страница {page} из {draft.pdf.numPages}</span><button className="outline-button" disabled={page >= draft.pdf.numPages} onClick={() => setPage(v => v + 1)}>Следующий<ChevronRight size={18} /></button></div><label className="confirm-label"><Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} />Я проверил(а) дату, номер и страницы выпуска</label><div className="button-row"><button className="primary-button" disabled={!confirmed || sending} onClick={() => void submitForReview()}>{sending ? 'Отправляем…' : 'Отправить на проверку'}<Check size={18} /></button><button className="text-button" onClick={() => { setStep(2); setError(''); }}>Назад к данным</button></div><p className="local-only">PDF попадёт в защищённую очередь на проверку. В публичном архиве выпуск появится после одобрения куратором.</p></section>}
    {preview && <section className="review-step submission-preview" aria-labelledby="submission-preview-title"><div className="review-topline"><div><span className="black-label">Предпросмотр заявки</span><h2 id="submission-preview-title">№ {preview.item.number} ({preview.item.serial}) · {preview.item.year}</h2><p>{preview.item.filename}</p></div><button className="text-button" type="button" onClick={closePreview}>Закрыть</button></div><div className="review-workspace"><nav className="review-thumbnails" aria-label="Страницы PDF заявки">{preview.thumbnails.map((src, index) => <button key={index} className={`thumbnail ${previewPage === index + 1 ? 'selected' : ''}`} onClick={() => setPreviewPage(index + 1)} aria-label={`Открыть страницу ${index + 1}`}><img src={src} alt="" /><span>{index + 1}</span></button>)}</nav><div className="review-canvas"><PdfCanvas pdf={preview.pdf} page={previewPage} width={700} /></div></div><div className="review-pagination"><button className="outline-button" disabled={previewPage <= 1} onClick={() => setPreviewPage(v => v - 1)}>Предыдущий</button><span>Страница {previewPage} из {preview.pdf.numPages}</span><button className="outline-button" disabled={previewPage >= preview.pdf.numPages} onClick={() => setPreviewPage(v => v + 1)}>Следующий</button></div></section>}
    {previewBusy && <div className="loading-message" role="status"><span className="loading-dot" />Готовим предпросмотр…</div>}
    {previewError && <div className="form-error" role="alert">{previewError}</div>}
    {queue && <section className="submission-queue" aria-labelledby="queue-title"><span className="black-label">Только для кураторов</span><h2 id="queue-title">Очередь заявок</h2>{queueError && <p className="form-error" role="alert">{queueError}</p>}{queue.length === 0 ? <p>Новых заявок нет.</p> : <div className="queue-list">{queue.map(item => <article className="queue-item" key={item.id}><div className="queue-item-main"><strong>№ {item.number} ({item.serial}) · {item.year}</strong><span>{item.dateLabel}</span><span>{item.pages} страниц</span></div><div className="queue-item-file"><strong>{item.filename}</strong><span className={`queue-status queue-status-${item.status}`}>{item.status === 'pending' ? 'На проверке' : item.status === 'approved' ? 'Одобрено' : item.status === 'rejected' ? 'Отклонено' : item.status}</span></div><div className="queue-item-actions"><button className="outline-button" type="button" onClick={() => void openPreview(item)}>Предпросмотр</button>{item.status === 'pending' && <><button className="primary-button" type="button" onClick={() => void moderate(item, 'approve')}>Одобрить</button><button className="text-button" type="button" onClick={() => void moderate(item, 'reject')}>Отклонить</button></>}</div></article>)}</div>}</section>}
    </>}
  </main>;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ kind: 'archive' });
  const [year, setYear] = useState(2000);
  const [archiveIssues, setArchiveIssues] = useState<Issue[]>(staticIssues);
  useEffect(() => {
    void fetch(manifestUrl(), { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(payload => {
      if (!payload || !Array.isArray(payload.issues)) return;
      const dynamic = payload.issues.filter((item: Issue) => item && typeof item.year === 'number' && typeof item.number === 'string' && typeof item.serial === 'string' && Number.isInteger(item.pages) && item.pages > 0 && typeof item.pdfUrl === 'string' && /^(https:\/\/|\/(?!\/))/.test(item.pdfUrl));
      const merged = new Map(staticIssues.map(item => [`${item.year}/${Number(item.number)}/${Number(item.serial)}`, item]));
      for (const item of dynamic) merged.set(`${item.year}/${Number(item.number)}/${Number(item.serial)}`, item);
      setArchiveIssues([...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || Number(a.number) - Number(b.number)));
    }).catch(() => undefined);
  }, []);
  const navigate = useCallback((next: Screen) => {
    if (next.kind === 'upload' && isPublicSite()) { window.location.assign(adminUrl()); return; }
    setScreen(next);
    const issue = next.kind === 'reader' ? archiveIssues.find(item => item.id === next.id) : undefined;
    window.location.hash = next.kind === 'reader' && issue ? issueRoute(issue) : next.kind === 'upload' ? 'add' : 'archive';
  }, [archiveIssues]);
  useEffect(() => {
    const update = () => {
      const hash = window.location.hash;
      const issueMatch = hash.match(/^#issue-(\d{4})-(\d{1,3})-(\d{4,5})(?:-p(\d+))?$/);
      const yearMatch = hash.match(/^#year-(\d{4})$/);
      const linkedIssue = issueMatch ? archiveIssues.find(issue => issue.year === Number(issueMatch[1]) && issue.number === issueMatch[2].padStart(2, '0') && issue.serial === issueMatch[3].padStart(4, '0')) : undefined;
      if (hash.startsWith('#add')) { if (isPublicSite()) { window.location.replace(adminUrl()); return; } setScreen({ kind: 'upload' }); }
      else if (linkedIssue) { setYear(linkedIssue.year); setScreen({ kind: 'reader', id: linkedIssue.id, page: issueMatch?.[4] ? Number(issueMatch[4]) : 1 }); }
      else { setScreen({ kind: 'archive' }); if (yearMatch && years.includes(Number(yearMatch[1]))) setYear(Number(yearMatch[1])); }
      if (hash === '#about' || hash === '#creators') requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }));
      else window.scrollTo(0, 0);
    };
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, [archiveIssues]);
  const back = useCallback(() => navigate({ kind: 'archive' }), [navigate]);
  useEffect(() => {
    const activeIssue = screen.kind === 'reader' ? archiveIssues.find(item => item.id === screen.id) : undefined;
  document.title = screen.kind === 'reader' ? `№ ${activeIssue?.number ?? ''} · Первый Пилот` : screen.kind === 'upload' ? 'Добавить выпуск · Первый Пилот' : 'Первый Пилот · Архив газеты 1996–2007';
  }, [screen]);
  if (screen.kind === 'reader') return <Reader key={screen.id} issue={archiveIssues.find(issue => issue.id === screen.id) ?? archiveIssues[0]} initialPage={screen.page} onBack={back} />;
  return <>
    <a className="skip-link" href="#main">К содержимому</a>
    <header className="site-header shell"><nav aria-label="Основная навигация"><a href="#archive" className={screen.kind === 'archive' ? 'active' : ''}>Архив</a><a href="#about" onClick={() => { if (screen.kind !== 'archive') setScreen({ kind: 'archive' }); }}>О газете</a><a href="#creators" onClick={() => { if (screen.kind !== 'archive') setScreen({ kind: 'archive' }); }}>Люди</a></nav><button className="header-add" onClick={() => navigate({ kind: 'upload' })}><Plus size={18} /><span>Добавить выпуск</span></button></header>
    {screen.kind === 'upload' ? <Upload onBack={back} /> : <main id="main" className="shell archive-page">
      <section className="masthead"><div className="masthead-brand"><Brand year={year} /></div><div className="masthead-description"><span className="black-label">Электронный архив</span><p>Молодёжная газета<br />Комсомольска-на-Амуре</p><span className="archive-dates">1996–2007</span></div></section>
      <div className="archive-title"><h1>Газета осталась.<br className="mobile-break" /> Время можно перелистать.</h1><span>{issueCountLabel(archiveIssues.length)} в архиве</span></div>
      <nav className="year-picker" aria-label="Выбрать год">{years.map(value => <a key={value} className={`${year === value ? 'selected ' : ''}${archiveIssues.some(issue => issue.year === value) ? 'has-issues' : ''}`} href={yearRoute(value)} aria-current={year === value ? 'page' : undefined}>{value}</a>)}</nav>
      <section className="archive-content" aria-label={`Выпуски за ${year} год`}>
        <aside className="year-summary"><span className="black-label">Год за годом</span><h2>{year}</h2><p>{year === 2000 ? 'Январь–март 2000 года.' : year === 2002 ? 'Декабрь 2002 года.' : 'Этот год ещё ждёт своих выпусков.'}</p><div className="year-total">{archiveIssues.filter(issue => issue.year === year).length ? issueCountLabel(archiveIssues.filter(issue => issue.year === year).length) : 'Нет загруженных выпусков'}</div><div className="archive-note"><p>Читаем газету такой,<br />какой она выходила.</p><span>Обложки и все страницы<br />в исходных материалах выпуска.</span></div></aside>
        {archiveIssues.some(issue => issue.year === year) ? <div className="issue-grid">{archiveIssues.filter(issue => issue.year === year).map(issue => <article className="issue-card" key={issue.id}><button className="cover-button" onClick={() => navigate({ kind: 'reader', id: issue.id })} aria-label={`Читать выпуск № ${issue.number} от ${issue.dateLabel}`}><div className="cover-frame"><img src={scanUrl(issue, 1)} alt={`Обложка газеты Первый Пилот № ${issue.number} (${issue.serial}), ${issue.dateLabel}`} width={issue.id === 1 ? 892 : 925} height={1300} fetchPriority="high" /><span className="cover-read">Открыть выпуск<ArrowRight size={20} /></span></div></button><div className="issue-meta"><h3>№ {issue.number} <span>({issue.serial})</span></h3><a className="issue-arrow" href={issueRoute(issue)} aria-label={`Открыть выпуск № ${issue.number}`}><ArrowRight size={24} /></a><time dateTime={issue.date}>{issue.dateLabel}</time><span className="issue-format">PDF · {issue.pages} страниц</span></div></article>)}</div> : <div className="empty-year"><div className="empty-lines" aria-hidden="true">ПП</div><h3>За {year} год пока пусто</h3><p>В архиве пока нет оцифрованных выпусков за этот год. Если у вас есть другие сканы, попробуйте форму добавления.</p><div className="button-row"><button className="primary-button" onClick={() => setYear(2000)}>К выпускам 2000 года<ArrowRight size={18} /></button><button className="text-button" onClick={() => navigate({ kind: 'upload' })}>Добавить PDF<Plus size={17} /></button></div></div>}
      </section>
      <section className="about-section" id="about"><div><span className="black-label">О газете</span><h2>Свой город. <br />Своё поколение.</h2></div><div><p>«Первый Пилот» — молодёжная газета Комсомольска-на-Амуре. Здесь собираем выпуски за 1996–2007 годы, чтобы их снова можно было читать.</p><p>В сохранившихся выпусках 2000 года: городские новости, музыка, кино, письма читателей и телепрограмма. Сохраняем газету целиком, вместе с рекламой и кроссвордами.</p></div><aside><h3>Сохранился выпуск?</h3><p>Попробуйте добавить PDF. Для этого не нужны специальные программы.</p><button className="underlined-button" onClick={() => navigate({ kind: 'upload' })}>Добавить выпуск<ArrowRight size={18} /></button><small>После проверки куратором выпуск появится в архиве</small></aside></section>
      <section className="creators-section" id="creators" aria-labelledby="creators-title"><div className="creators-heading"><span className="black-label">Люди «Пилота»</span><h2 id="creators-title">Газету делали<br />сами люди.</h2><p>Имена людей, связанных с газетой. Состав постепенно уточняем по сохранившимся номерам и воспоминаниям.</p></div><div className="creator-list"><article><strong>Олеся Луконина</strong></article><article><strong>Константин Луконин</strong></article><article><strong>Павел Трутнев</strong></article><article><strong>Александр Бочкарев</strong></article><article><strong>Вадим Горуленко</strong></article><article><strong>Ульяна Крикливая</strong></article><article><strong>Алексей Ларин</strong></article><article><strong>Светлана Гулай</strong></article><article><strong>Наталья Останина</strong></article><article><strong>Ольга Харламова</strong></article><article><strong>Анна Сидорова</strong></article><article><strong>Сергей Долженко</strong></article><article><strong>Сергей Бадулин</strong></article><article><strong>Марина Бабич</strong></article><article><strong>Кирилл Маковеев</strong></article><article><strong>Александр Утюпин</strong></article><article><strong>Леонид Шевченко</strong></article><article><strong>Евгения Белоусова</strong></article><article><strong>Захар Веселов</strong></article><article><strong>Владимир Ерошенко</strong></article><article><strong>Дарья Демешко</strong></article></div></section>
    </main>}
    <footer className="site-footer shell"><span>Первый Пилот © Архив газеты</span><span>Комсомольск-на-Амуре · 1996–2007</span></footer>
  </>;
}
