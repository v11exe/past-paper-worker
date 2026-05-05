import { describe, expect, it, vi } from "vitest";
import worker from "./index";

describe("worker routing", () => {
  it("reports runtime env presence without exposing the Gemini key", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/debug/env"), {
      GEMINI_API_KEY: "configured",
      ASSETS: { fetch: vi.fn(async () => new Response("asset")) },
    } as never, undefined);

    expect(response.status).toBe(200);
    const clone = response.clone();
    await expect(response.json()).resolves.toMatchObject({
      hasKey: true,
    });
    const json = await clone.json();
    expect(json.keys).toContain("GEMINI_API_KEY");
    expect(JSON.stringify(json)).not.toContain("configured");
  });

  it("returns a runtime-secret hint when /api/ai is hit without GEMINI_API_KEY", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "paper_mark",
          model: "gemini-2.5-flash-lite",
          prompt: "mark this answer",
        }),
      }),
      {
        ASSETS: { fetch: vi.fn(async () => new Response("asset")) },
      } as never,
      undefined,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      operation: "paper_mark",
      error: {
        message: "GEMINI_API_KEY missing at runtime",
      },
      hint: "Check Cloudflare Worker runtime secrets, not build variables",
    });
  });

  it("routes POST /api/ai through the Gemini proxy handler", async () => {
    const assetFetch = vi.fn(async () => new Response("asset"));
    const response = await worker.fetch(
      new Request("https://example.com/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "smoke_ping",
          model: "gemini-2.5-flash-lite",
          prompt: "ping",
        }),
      }),
      {
        GEMINI_API_KEY: "configured",
        ASSETS: { fetch: assetFetch },
      } as never,
      undefined,
    );

    expect(assetFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      operation: "smoke_ping",
    });
  });

  it("serves non-API requests from the static asset binding", async () => {
    const assetFetch = vi.fn(async () => new Response("<html>ok</html>", { status: 200 }));

    const response = await worker.fetch(new Request("https://example.com/"), {
      ASSETS: { fetch: assetFetch },
    } as never, undefined);

    expect(assetFetch).toHaveBeenCalledTimes(1);
    expect(await response.text()).toContain("ok");
  });
});
