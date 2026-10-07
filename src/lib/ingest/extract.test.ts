import { describe, expect, it } from "vitest";
import { IngestError } from "./errors";
import { extractWebPage, htmlToMarkdown } from "./extract-url";
import { extractPdf, normalizePdfText } from "./extract-pdf";

/** Build a minimal but valid multi-page text PDF (Helvetica) — one string per page. */
export function makePdf(pages: string[]): Uint8Array {
  const objs: string[] = [];
  const kids: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, i) => {
    const pageObj = 4 + i * 2;
    const contentObj = pageObj + 1;
    kids.push(`${pageObj} 0 R`);
    const lines = text.split("\n").map((l, j) => `1 0 0 1 50 ${740 - j * 16} Tm (${l.replace(/[()\\]/g, "\\$&")}) Tj`);
    const stream = `BT /F1 12 Tf\n${lines.join("\n")}\nET`;
    objs[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objs[n]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe("htmlToMarkdown", () => {
  it("keeps headings, fenced code with language, lists and inline code", () => {
    const md = htmlToMarkdown(`
      <h2>Indexes</h2>
      <p>Use <code>EXPLAIN</code> to see the <strong>plan</strong>.</p>
      <pre><code class="language-sql">SELECT 1;\nSELECT 2;</code></pre>
      <ul><li>first</li><li>second</li></ul>
      <ol><li>one</li><li>two</li></ol>`);
    expect(md).toContain("## Indexes");
    expect(md).toContain("Use `EXPLAIN` to see the **plan**.");
    expect(md).toContain("```sql\nSELECT 1;\nSELECT 2;\n```");
    expect(md).toContain("- first\n- second");
    expect(md).toContain("1. one\n2. two");
  });

  it("strips docs-site permalink glyphs from headings but never mangles real titles like C# or F#", () => {
    const md = htmlToMarkdown(
      `<h2>5.1. More on Lists<a class="headerlink" href="#x">¶</a></h2>
       <h3>Section 2 §</h3>
       <h3>Anchored title #</h3>
       <h2>Learning C#</h2>
       <h2>Why F# is fun</h2>`,
    );
    expect(md).toContain("## 5.1. More on Lists\n");
    expect(md).toContain("### Section 2\n");
    expect(md).toContain("### Anchored title\n");
    expect(md).not.toContain("¶");
    expect(md).toContain("## Learning C#");
    expect(md).toContain("## Why F# is fun");
  });

  it("drops scripts, styles, nav and images", () => {
    const md = htmlToMarkdown(
      `<nav>Home About</nav><script>evil()</script><style>.x{}</style><p>Real text <img src=x alt="pic"></p>`,
    );
    expect(md).toBe("Real text");
  });

  it("renders tables as pipe rows and keeps link text but not URLs", () => {
    const md = htmlToMarkdown(
      `<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><p><a href="https://x.test/secret">docs</a></p>`,
    );
    expect(md).toContain("| A | B |\n| 1 | 2 |");
    expect(md).toContain("docs");
    expect(md).not.toContain("x.test");
  });
});

describe("extractWebPage", () => {
  const article = (n: number) =>
    Array.from({ length: n }, (_, i) => `<p>Paragraph ${i} explains how B-tree indexes speed up lookups by keeping keys sorted.</p>`).join("");

  it("extracts the article and leaves out navigation and footer chrome", () => {
    const html = `<!doctype html><html><head><title>Indexing Guide | Example</title></head><body>
      <nav><a>HOME-LINK</a><a>PRICING-LINK</a></nav>
      <article><h1>Indexing Guide</h1>${article(12)}</article>
      <footer>COPYRIGHT-FOOTER</footer></body></html>`;
    const { title, markdown } = extractWebPage(html, new URL("https://example.com/guide"));
    expect(title).toContain("Indexing Guide");
    expect(markdown).toContain("B-tree indexes");
    expect(markdown).not.toContain("HOME-LINK");
    expect(markdown).not.toContain("COPYRIGHT-FOOTER");
  });

  it("rejects pages with no readable text (e.g. JS-only shells)", () => {
    const html = `<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script>boot()</script></body></html>`;
    expect(() => extractWebPage(html, new URL("https://spa.example.com/"))).toThrow(IngestError);
  });
});

describe("extractPdf", () => {
  const body = (n: number) =>
    `Chapter ${n}: Replication lag happens when followers apply writes slower than the leader emits them.\nMonitor it and alert before reads become stale.`;

  it("extracts text per page with page numbers", async () => {
    const { pages, title } = await extractPdf(makePdf([body(1), body(2), body(3)]), "notes.pdf");
    expect(title).toBe("notes.pdf");
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(pages[1].text).toContain("Chapter 2");
    expect(pages[2].text).toContain("Replication lag");
  });

  it("rejects a PDF with no text layer (scanned)", async () => {
    await expect(extractPdf(makePdf(["", ""]), "scan.pdf")).rejects.toThrow(/scan/i);
  });

  it("rejects bytes that aren't a PDF", async () => {
    await expect(extractPdf(new TextEncoder().encode("hello, not a pdf"), "x.pdf")).rejects.toBeInstanceOf(IngestError);
  });
});

describe("normalizePdfText", () => {
  it("re-joins words hyphenated across lines and collapses whitespace", () => {
    expect(normalizePdfText("replic-\nation   lag\n\n\n\nnext")).toBe("replication lag\n\nnext");
  });
});
