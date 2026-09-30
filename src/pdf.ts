// pdf.js with the worker and assets served from /pdfjs.
export async function openPdf(data: ArrayBuffer | string) {
  const engine = await import("pdfjs-dist");
  engine.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const task = engine.getDocument({
    ...(typeof data === "string" ? {url: data} : {data}),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    disableAutoFetch: true,
    disableStream: true,
  });
  task.onPassword = () => {
    void task.destroy();
  };
  return task.promise;
}
