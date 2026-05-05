import { describe, expect, it, vi } from "vitest";
import worker from "./index";

describe("worker routing", () => {
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
      },
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
    } as never);

    expect(assetFetch).toHaveBeenCalledTimes(1);
    expect(await response.text()).toContain("ok");
  });
});
