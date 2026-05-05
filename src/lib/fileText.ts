import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { AssetExtractionDiagnostics, PaperPageScreenshot, PaperPageText, PastPaperAsset } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const readableTextTypes = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
const PAGE_IMAGE_MIME = "image/jpeg";
const PAGE_IMAGE_QUALITY = 0.56;
const THUMBNAIL_QUALITY = 0.48;
const PAGE_TARGET_WIDTH = 900;
const THUMBNAIL_TARGET_WIDTH = 220;

export type ExtractedFileAssetContent = Pick<PastPaperAsset, "textContent" | "pageCount" | "pageTexts" | "pageScreenshots" | "extractionDiagnostics">;

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function dataUrlByteSize(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return dataUrl.length;
  const base64Length = dataUrl.length - commaIndex - 1;
  return Math.round((base64Length * 3) / 4);
}

function makeDiagnostics(input: {
  pageCount: number;
  pageTexts: PaperPageText[];
  pageScreenshots: PaperPageScreenshot[];
  warnings: string[];
}): AssetExtractionDiagnostics {
  return {
    pageCount: input.pageCount,
    textCharCount: input.pageTexts.reduce((sum, page) => sum + page.charCount, 0),
    pageTextCharCounts: input.pageTexts.map((page) => ({ pageNumber: page.pageNumber, charCount: page.charCount })),
    screenshotCount: input.pageScreenshots.length,
    screenshots: input.pageScreenshots.map((screenshot) => ({
      pageNumber: screenshot.pageNumber,
      width: screenshot.width,
      height: screenshot.height,
      byteSize: screenshot.byteSize,
      thumbnailByteSize: screenshot.thumbnailByteSize,
      mimeType: screenshot.mimeType,
    })),
    warnings: input.warnings,
  };
}

function resizeCanvas(source: HTMLCanvasElement, targetWidth: number, mimeType: string, quality: number) {
  const width = Math.min(targetWidth, source.width);
  const height = Math.max(1, Math.round((source.height / source.width) * width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
  context.drawImage(source, 0, 0, width, height);
  const dataUrl = canvas.toDataURL(mimeType, quality);
  canvas.width = 0;
  canvas.height = 0;
  return { dataUrl, width, height };
}

async function renderPdfPageScreenshot(page: Awaited<ReturnType<Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>["getPage"]>>, pageNumber: number) {
  const baseViewport = page.getViewport({ scale: 1 });
  const renderScale = Math.min(1.55, Math.max(0.8, PAGE_TARGET_WIDTH / baseViewport.width));
  const viewport = page.getViewport({ scale: renderScale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable in this browser.");

  await page.render({ canvasContext: context, viewport }).promise;

  const dataUrl = canvas.toDataURL(PAGE_IMAGE_MIME, PAGE_IMAGE_QUALITY);
  const thumbnail = resizeCanvas(canvas, THUMBNAIL_TARGET_WIDTH, PAGE_IMAGE_MIME, THUMBNAIL_QUALITY);
  const screenshot: PaperPageScreenshot = {
    pageNumber,
    dataUrl,
    thumbnailDataUrl: thumbnail.dataUrl,
    width: canvas.width,
    height: canvas.height,
    byteSize: dataUrlByteSize(dataUrl),
    thumbnailByteSize: dataUrlByteSize(thumbnail.dataUrl),
    mimeType: PAGE_IMAGE_MIME,
    renderScale,
  };

  canvas.width = 0;
  canvas.height = 0;
  return screenshot;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image could not be decoded for screenshot capture."));
    image.src = url;
  });
}

async function renderImageFileScreenshot(file: File): Promise<PaperPageScreenshot[]> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const width = Math.min(PAGE_TARGET_WIDTH, image.naturalWidth || image.width || PAGE_TARGET_WIDTH);
    const height = Math.max(1, Math.round(((image.naturalHeight || image.height || PAGE_TARGET_WIDTH) / (image.naturalWidth || image.width || PAGE_TARGET_WIDTH)) * width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL(PAGE_IMAGE_MIME, PAGE_IMAGE_QUALITY);
    const thumbnail = resizeCanvas(canvas, THUMBNAIL_TARGET_WIDTH, PAGE_IMAGE_MIME, THUMBNAIL_QUALITY);
    const screenshot: PaperPageScreenshot = {
      pageNumber: 1,
      dataUrl,
      thumbnailDataUrl: thumbnail.dataUrl,
      width,
      height,
      byteSize: dataUrlByteSize(dataUrl),
      thumbnailByteSize: dataUrlByteSize(thumbnail.dataUrl),
      mimeType: PAGE_IMAGE_MIME,
      renderScale: width / Math.max(1, image.naturalWidth || image.width || width),
    };
    canvas.width = 0;
    canvas.height = 0;
    return [screenshot];
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function extractFileAssetContent(file: File): Promise<ExtractedFileAssetContent> {
  const warnings: string[] = [];

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    try {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      const pageTexts: PaperPageText[] = [];
      const pageScreenshots: PaperPageScreenshot[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = normalizeText(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
        pageTexts.push({ pageNumber, text, charCount: text.length });

        try {
          pageScreenshots.push(await renderPdfPageScreenshot(page, pageNumber));
        } catch (error) {
          warnings.push(`Page ${pageNumber} screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const textContent = pageTexts.map((page) => `Page ${page.pageNumber}\n${page.text}`).join("\n\n").trim();
      return {
        textContent,
        pageCount: pdf.numPages,
        pageTexts,
        pageScreenshots,
        extractionDiagnostics: makeDiagnostics({ pageCount: pdf.numPages, pageTexts, pageScreenshots, warnings }),
      };
    } catch (error) {
      warnings.push(`PDF extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        textContent: "",
        pageCount: 0,
        pageTexts: [],
        pageScreenshots: [],
        extractionDiagnostics: makeDiagnostics({ pageCount: 0, pageTexts: [], pageScreenshots: [], warnings }),
      };
    }
  }

  if (file.type.startsWith("image/")) {
    let pageScreenshots: PaperPageScreenshot[] = [];
    try {
      pageScreenshots = await renderImageFileScreenshot(file);
    } catch (error) {
      warnings.push(`Image screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
      textContent: "",
      pageCount: 1,
      pageTexts: [{ pageNumber: 1, text: "", charCount: 0 }],
      pageScreenshots,
      extractionDiagnostics: makeDiagnostics({ pageCount: 1, pageTexts: [{ pageNumber: 1, text: "", charCount: 0 }], pageScreenshots, warnings }),
    };
  }

  if (readableTextTypes.has(file.type) || /\.(txt|md|csv|json)$/i.test(file.name)) {
    const text = await file.text();
    const pageText = { pageNumber: 1, text, charCount: text.length };
    return {
      textContent: text,
      pageCount: 1,
      pageTexts: [pageText],
      pageScreenshots: [],
      extractionDiagnostics: makeDiagnostics({ pageCount: 1, pageTexts: [pageText], pageScreenshots: [], warnings }),
    };
  }

  return {
    textContent: "",
    pageCount: 0,
    pageTexts: [],
    pageScreenshots: [],
    extractionDiagnostics: makeDiagnostics({ pageCount: 0, pageTexts: [], pageScreenshots: [], warnings: ["Unsupported file type for text or page-image extraction."] }),
  };
}

export async function extractFileText(file: File) {
  const extracted = await extractFileAssetContent(file);
  return extracted.textContent ?? "";
}
