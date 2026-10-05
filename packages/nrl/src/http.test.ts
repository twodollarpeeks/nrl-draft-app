import { describe, expect, it } from "vitest";
import { HttpError, PoliteFetcher, type Logger } from "./http.ts";

const silent: Logger = { info() {}, warn() {} };

function fakeFetch(responses: Array<number | Error>) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const next = responses.shift() ?? 200;
    if (next instanceof Error) throw next;
    return new Response(`body ${calls.length}`, { status: next });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("PoliteFetcher", () => {
  it("retries 5xx and network errors, then succeeds", async () => {
    const { impl, calls } = fakeFetch([503, new Error("socket hang up"), 200]);
    const sleeps: number[] = [];
    const f = new PoliteFetcher({
      fetchImpl: impl, logger: silent, minIntervalMs: 0,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(await f.getText("/x")).toBe("body 3");
    expect(calls).toEqual(Array(3).fill("https://www.nrl.com/x"));
    expect(sleeps).toEqual([2000, 4000]); // exponential backoff
  });

  it("does not retry a 404", async () => {
    const { impl, calls } = fakeFetch([404]);
    const f = new PoliteFetcher({ fetchImpl: impl, logger: silent, minIntervalMs: 0, sleep: async () => {} });
    await expect(f.getText("/missing")).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(1);
  });

  it("gives up after maxAttempts", async () => {
    const { impl, calls } = fakeFetch([500, 500, 500]);
    const f = new PoliteFetcher({
      fetchImpl: impl, logger: silent, minIntervalMs: 0, maxAttempts: 3, sleep: async () => {},
    });
    await expect(f.getText("/x")).rejects.toThrow("HTTP 500");
    expect(calls).toHaveLength(3);
  });

  it("spaces out concurrent requests", async () => {
    const { impl } = fakeFetch([]);
    const f = new PoliteFetcher({ fetchImpl: impl, logger: silent, minIntervalMs: 40 });
    const t0 = Date.now();
    await Promise.all([f.getText("/a"), f.getText("/b"), f.getText("/c")]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(75);
  });
});
