import { describe, expect, it, vi } from "vitest";
import { loadData, saveData } from "./storage";
import type { AppData } from "../types";

const dataWithScreenshot: AppData = {
  papers: [
    {
      id: "paper",
      title: "Paper",
      subject: "Biology",
      topic: null,
      subtopic: null,
      year: null,
      series: null,
      paperCode: null,
      totalMarks: null,
      durationMinutes: null,
      hasMarkScheme: false,
      processingStatus: "unprocessed",
      processingError: null,
      assets: [
        {
          id: "asset",
          paperId: "paper",
          kind: "paper",
          fileName: "paper.pdf",
          mimeType: "application/pdf",
          size: 123,
          textContent: "Page 1\nQuestion text",
          pageCount: 1,
          pageTexts: [{ pageNumber: 1, text: "Question text", charCount: 13 }],
          pageScreenshots: [
            {
              pageNumber: 1,
              dataUrl: `data:image/jpeg;base64,${"A".repeat(5000)}`,
              thumbnailDataUrl: "data:image/jpeg;base64,thumb",
              width: 10,
              height: 10,
              byteSize: 4000,
              thumbnailByteSize: 10,
              mimeType: "image/jpeg",
              renderScale: 1,
            },
          ],
          objectUrl: "blob:test",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      questions: [],
      jobs: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  attempts: [],
};

describe("saveData", () => {
  it("strips full screenshot data URLs before localStorage persistence", () => {
    saveData(dataWithScreenshot);

    const saved = loadData();
    expect(saved.papers[0].assets[0].pageScreenshots?.[0].dataUrl).toBe("");
    expect(saved.papers[0].assets[0].pageScreenshots?.[0].thumbnailDataUrl).toContain("thumb");
    expect(saved.papers[0].assets[0].objectUrl).toBeNull();
  });

  it("preserves unlocked achievements in local persistence", () => {
    saveData({ ...dataWithScreenshot, achievementUnlocks: ["first_upload", "first_mark"] });

    expect(loadData().achievementUnlocks).toEqual(["first_upload", "first_mark"]);
  });

  it("does not throw when localStorage is unavailable or over quota", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => saveData(dataWithScreenshot)).not.toThrow();

    spy.mockRestore();
    errorSpy.mockRestore();
  });
});
