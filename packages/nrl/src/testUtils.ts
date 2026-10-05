import { readFileSync } from "node:fs";

/** Wrap a saved q-data JSON fixture back into a page the way nrl.com serves it. */
export function fixturePage(name: string): string {
  const json = readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
  const escaped = JSON.stringify(JSON.parse(json))
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<html><body><div id="vue-x" q-data="${escaped}"></div></body></html>`;
}
