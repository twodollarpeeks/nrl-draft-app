// nrl.com pages are server-rendered, but embed the data each page was built
// from as JSON in an HTML-escaped `q-data` attribute. That JSON is the most
// reliable thing on the page to parse — far more stable than the markup.

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

/** All q-data payloads on a page, parsed. */
export function extractQData(html: string): unknown[] {
  return [...html.matchAll(/\sq-data="([^"]*)"/g)].map((m) => JSON.parse(decodeHtmlEntities(m[1]!)));
}

/** The first q-data payload that has `key` at its top level. */
export function findQData(html: string, key: string): unknown {
  const found = extractQData(html).find(
    (d) => typeof d === "object" && d !== null && key in d,
  );
  if (found === undefined) throw new Error(`No q-data block with "${key}" found on page`);
  return found;
}

/** Position text from a player profile page, e.g. "Prop". */
export function extractProfilePosition(html: string): string | null {
  const m = html.match(/class="club-card__position"[^>]*>([^<]+)</);
  return m ? decodeHtmlEntities(m[1]!).trim() || null : null;
}
