import { describe, expect, it } from "vitest";
import { UnsafeUrlError, assertPublicHttpUrl, isPublicIp } from "./ssrf";
import { MAX_CHARS, chunkMarkdown, chunkPages } from "./chunk";

describe("isPublicIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata endpoint
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:7f00:1", // same, hex form
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1",
    "not-an-ip",
  ])("rejects %s", (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.255.255", "2606:4700:4700::1111"])(
    "accepts %s",
    (ip) => {
      expect(isPublicIp(ip)).toBe(true);
    },
  );

  it("accepts an IPv4-mapped public address", () => {
    expect(isPublicIp("::ffff:8.8.8.8")).toBe(true);
  });
});

describe("assertPublicHttpUrl", () => {
  it.each([
    "http://localhost:3000/admin",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    "http://printer.local/",
    "http://service.internal/",
    "http://0x7f.0.0.1/", // WHATWG URL normalizes this to 127.0.0.1
    "http://2130706433/", // decimal form of 127.0.0.1
    "ftp://example.com/file",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://user:pass@example.com/",
    "nonsense",
  ])("rejects %s", async (url) => {
    await expect(assertPublicHttpUrl(url)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("accepts a public IP literal without DNS", async () => {
    const url = await assertPublicHttpUrl("https://8.8.8.8/dns");
    expect(url.hostname).toBe("8.8.8.8");
  });
});

describe("chunkPages", () => {
  const page = (n: number, chars: number) => ({ page: n, text: `Page ${n}. ` + "word ".repeat(chars / 5) });

  it("packs small PDFs into one chunk with a page range", () => {
    const chunks = chunkPages([page(1, 500), page(2, 500), page(3, 500)]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sourceRef).toBe("pp. 1–3");
  });

  it("splits large PDFs into several chunks that respect the size target", () => {
    const pages = Array.from({ length: 30 }, (_, i) => page(i + 1, 4000));
    const chunks = chunkPages(pages, 24_000);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(24_000 + 4000);
    // Page ranges are contiguous and cover the whole document.
    const refs = chunks.map((c) => c.sourceRef!);
    expect(refs[0]).toMatch(/^pp?\. 1/);
    expect(refs.at(-1)).toMatch(/30$/);
  });

  it("labels a single-page chunk 'p. N' and skips blank pages", () => {
    const chunks = chunkPages([{ page: 7, text: "hello" }, { page: 8, text: "   " }]);
    expect(chunks).toEqual([{ text: "hello", sourceRef: "p. 7" }]);
  });

  it("splits one enormous page instead of exceeding the hard max", () => {
    const chunks = chunkPages([{ page: 1, text: "x".repeat(MAX_CHARS * 2 + 10) }]);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(MAX_CHARS);
  });
});

describe("chunkMarkdown", () => {
  it("labels chunks with their first heading", () => {
    const md = "# Intro\n\nSome intro text.\n\n## Indexing\n\nB-trees are great.";
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sourceRef).toBe("Intro");
  });

  it("starts a new chunk at a heading boundary when over target, keeping sections whole", () => {
    // Each section is ~3.1K chars: two together exceed the 4.5K target, one alone fits.
    const sec = (title: string) => `## ${title}\n\n${"para text. ".repeat(280)}`;
    const md = [sec("Alpha"), sec("Beta"), sec("Gamma")].join("\n\n");
    const chunks = chunkMarkdown(md, 4500, 6000);
    expect(chunks.map((c) => c.sourceRef)).toEqual(["Alpha", "Beta", "Gamma"]);
    for (const c of chunks) expect(c.text.startsWith("## ")).toBe(true);
  });

  it("does not treat '#' lines inside code fences as headings", () => {
    const md = "## Real\n\n```bash\n# just a comment\necho hi\n```\n\nafter";
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sourceRef).toBe("Real");
    expect(chunks[0].text).toContain("# just a comment");
  });

  it("loses no content when splitting", () => {
    const words = Array.from({ length: 6000 }, (_, i) => `w${i}`);
    const md = `# T\n\n${words.join(" ")}`;
    const chunks = chunkMarkdown(md, 5000, 7000);
    const joined = chunks.map((c) => c.text).join(" ");
    for (const w of ["w0", "w2999", "w5999"]) expect(joined).toContain(w);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("returns nothing for empty input", () => {
    expect(chunkMarkdown("  \n\n ")).toEqual([]);
  });
});
