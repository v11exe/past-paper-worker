import type { PastPaper } from "../types";

export function paperThumbnailSrc(paper: PastPaper) {
  const paperAsset = paper.assets.find((asset) => asset.kind === "paper") ?? paper.assets[0];
  const screenshot = paperAsset?.pageScreenshots?.find((item) => item.thumbnailDataUrl || item.dataUrl);
  if (!screenshot) return null;
  return screenshot.thumbnailDataUrl || screenshot.dataUrl || null;
}
