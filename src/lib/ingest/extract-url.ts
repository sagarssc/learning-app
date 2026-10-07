import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { IngestError } from "./errors";

const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "iframe", "nav", "aside", "form", "button"]);
const MIN_CHARS = 200;

type N = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<N>;
  getAttribute?: (name: string) => string | null;
  querySelector?: (sel: string) => N | null;
};

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function tag(n: N) {
  return n.nodeName.toLowerCase();
}

/** Inline content of a node (no block structure): text, bold/italic, inline code. */
function inline(node: N): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      out += (child.textContent ?? "").replace(/\s+/g, " ");
    } else if (child.nodeType === ELEMENT_NODE) {
      const t = tag(child);
      if (SKIP_TAGS.has(t) || t === "img") continue;
      const inner = inline(child);
      if (t === "br") out += "\n";
      else if (t === "code") out += inner.trim() ? `\`${inner.trim()}\`` : "";
      else if (t === "strong" || t === "b") out += inner.trim() ? `**${inner.trim()}**` : "";
      else if (t === "em" || t === "i") out += inner.trim() ? `*${inner.trim()}*` : "";
      else out += inner; // links keep their text only (URLs would just burn tokens)
    }
  }
  return out;
}

function block(node: N, out: string[], listDepth = 0): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) out.push(text);
      continue;
    }
    if (child.nodeType !== ELEMENT_NODE) continue;
    const t = tag(child);
    if (SKIP_TAGS.has(t) || t === "img" || t === "hr") continue;

    if (/^h[1-6]$/.test(t)) {
      // Docs generators append permalink glyphs to headings (Sphinx "¶", others "§"/"🔗"/" #").
      // A '#' only counts as a permalink when set apart by a space, so "C#" and "F#" survive.
      const text = inline(child).replace(/(?:\s*[¶§🔗]+|\s+#+)\s*$/u, "").trim();
      if (text) out.push(`${"#".repeat(Number(t[1]))} ${text}`);
    } else if (t === "pre") {
      const code = child.querySelector?.("code");
      const lang = (code?.getAttribute?.("class") ?? child.getAttribute?.("class") ?? "").match(
        /(?:lang(?:uage)?-)([\w+#-]+)/,
      )?.[1];
      const text = (child.textContent ?? "").replace(/\n+$/, "");
      if (text.trim()) out.push("```" + (lang ?? "") + "\n" + text + "\n```");
    } else if (t === "ul" || t === "ol") {
      const items: string[] = [];
      let i = 1;
      for (const li of Array.from(child.childNodes)) {
        if (li.nodeType !== ELEMENT_NODE || tag(li) !== "li") continue;
        const parts: string[] = [];
        block(li, parts, listDepth + 1);
        const [first = "", ...rest] = parts.join("\n").split("\n");
        const marker = t === "ol" ? `${i++}.` : "-";
        const indent = "  ".repeat(listDepth);
        items.push(`${indent}${marker} ${first}${rest.map((l) => `\n${indent}  ${l}`).join("")}`);
      }
      if (items.length) out.push(items.join("\n"));
    } else if (t === "blockquote") {
      const parts: string[] = [];
      block(child, parts);
      if (parts.length) out.push(parts.join("\n\n").replace(/^/gm, "> "));
    } else if (t === "table") {
      const rows: string[] = [];
      for (const tr of Array.from((child as unknown as { querySelectorAll(s: string): ArrayLike<N> }).querySelectorAll("tr"))) {
        const cells = Array.from((tr as unknown as { querySelectorAll(s: string): ArrayLike<N> }).querySelectorAll("th,td"));
        rows.push("| " + cells.map((c) => inline(c).trim().replace(/\|/g, "\\|")).join(" | ") + " |");
      }
      if (rows.length) out.push(rows.join("\n"));
    } else if (t === "p" || t === "figcaption" || t === "dt" || t === "dd" || t === "li") {
      const text = inline(child).trim();
      if (text) out.push(text);
    } else {
      // div, section, article, span, ...: descend; if it only has inline content, treat as a paragraph.
      const hasBlockChild = Array.from(child.childNodes).some(
        (c) => c.nodeType === ELEMENT_NODE && /^(h[1-6]|p|pre|ul|ol|table|blockquote|div|section|article|figure)$/.test(tag(c)),
      );
      if (hasBlockChild) block(child, out, listDepth);
      else {
        const text = inline(child).trim();
        if (text) out.push(text);
      }
    }
  }
}

/** Convert an HTML fragment to compact markdown that keeps headings, code, lists and tables. */
export function htmlToMarkdown(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const out: string[] = [];
  block(document.body as unknown as N, out);
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Pull the main article out of a full HTML page. */
export function extractWebPage(html: string, pageUrl: URL): { title: string; markdown: string } {
  const { document } = parseHTML(html);
  const metaTitle =
    document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    document.querySelector("title")?.textContent;

  let article: { title?: string | null; content?: string | null } | null = null;
  try {
    article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
  } catch {
    article = null;
  }

  let markdown = article?.content ? htmlToMarkdown(article.content) : "";
  if (markdown.length < MIN_CHARS) {
    // Readability found nothing useful (docs sites, odd layouts): fall back to the whole body.
    const { document: fresh } = parseHTML(html);
    markdown = htmlToMarkdown(fresh.body?.innerHTML ?? "");
  }
  if (markdown.length < MIN_CHARS) {
    throw new IngestError(
      "Couldn't find readable text on that page. It may need JavaScript to load, or be behind a login.",
    );
  }

  const title = (article?.title || metaTitle || pageUrl.hostname).replace(/\s+/g, " ").trim();
  return { title: title.slice(0, 200), markdown };
}
