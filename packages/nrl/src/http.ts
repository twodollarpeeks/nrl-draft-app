// Polite HTTP client for nrl.com: one request at a time, a minimum gap between
// requests, retries with exponential backoff on network errors / 429 / 5xx.

export const BASE_URL = "https://www.nrl.com";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

export const consoleLogger: Logger = {
  info: (m) => console.log(`[nrl] ${m}`),
  warn: (m) => console.warn(`[nrl] WARN ${m}`),
};

export interface FetcherOptions {
  minIntervalMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  logger?: Logger;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PoliteFetcher {
  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly log: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: FetcherOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 2500;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.log = opts.logger ?? consoleLogger;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /** GET a page as text. Requests are serialised, even if called concurrently. */
  getText(pathOrUrl: string): Promise<string> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : BASE_URL + pathOrUrl;
    const run = this.queue.then(() => this.fetchWithRetry(url));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async fetchWithRetry(url: string): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();

      try {
        const res = await this.fetchImpl(url, {
          // Without these, nrl.com treats us as a browser navigation and
          // bounces through a silent single-sign-on probe on account.nrl.com
          // that only a real browser can complete. The cookie is the one
          // nrl.com itself sets once that probe has run.
          headers: { "User-Agent": USER_AGENT, Accept: "*/*", Cookie: "nrl_sso_probed=1" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok && res.url && new URL(res.url).host !== new URL(url).host) {
          throw new Error(`Redirected away from ${url} to ${new URL(res.url).host} (sign-in probe?)`);
        }
        if (res.ok) return await res.text();
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= this.maxAttempts) throw new HttpError(res.status, url);
        this.log.warn(`HTTP ${res.status} for ${url} (attempt ${attempt}), retrying`);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (attempt >= this.maxAttempts) throw err;
        this.log.warn(`${(err as Error).message} for ${url} (attempt ${attempt}), retrying`);
      }
      await this.sleep(2 ** attempt * 1000);
    }
  }
}
