import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { readPackage } from "@/lib/documents/epub";
import { readEpubInfo, rewriteOpf, writeEpub } from "@/lib/documents/epubMetadata";
import { parseXml } from "@/lib/text/xml";

const CONTAINER = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

const EPUB3_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:1234</dc:identifier>
    <dc:title>Notes on the Engine</dc:title>
    <dc:creator id="a1">Ada Lovelace</dc:creator>
    <meta refines="#a1" property="role" scheme="marc:relators">aut</meta>
    <dc:language>en</dc:language>
    <dc:subject>Mathematics</dc:subject>
    <meta property="belongs-to-collection" id="c1">Computing</meta>
    <meta refines="#c1" property="group-position">2</meta>
    <meta property="rendition:layout">reflowable</meta>
    <meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>
`;

const EPUB2_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Old Title</dc:title>
    <dc:creator opf:role="aut">Someone &amp; Another</dc:creator>
    <dc:identifier id="id">isbn:978</dc:identifier>
    <meta name="calibre:series" content="Tales"/>
    <meta name="calibre:series_index" content="3"/>
    <meta name="cover" content="cov"/>
  </metadata>
  <manifest><item id="cov" href="cover.png" media-type="image/png"/><item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>
`;

function book(opf: string, cover: string): Uint8Array {
  return zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(CONTAINER),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/one.xhtml": strToU8("<html><body><p>One.</p></body></html>"),
    [`OEBPS/${cover}`]: new Uint8Array([1, 2, 3]),
  });
}

describe("reading an e-book's details", () => {
  it("reads EPUB 3: creators, series from belongs-to-collection, and the cover by its property", () => {
    const info = readEpubInfo(unzipSync(book(EPUB3_OPF, "images/cover.jpg")));
    expect(info).toMatchObject({ version: 3, opfPath: "OEBPS/content.opf", identifier: "urn:uuid:1234", cover: { path: "OEBPS/images/cover.jpg", mediaType: "image/jpeg" } });
    expect(info.metadata).toEqual({ title: "Notes on the Engine", authors: ["Ada Lovelace"], series: "Computing", seriesIndex: "2", language: "en", publisher: "", date: "", description: "", subjects: ["Mathematics"] });
  });

  it("reads EPUB 2: calibre's series and the cover named in a meta", () => {
    const info = readEpubInfo(unzipSync(book(EPUB2_OPF, "cover.png")));
    expect(info.metadata).toMatchObject({ title: "Old Title", authors: ["Someone & Another"], series: "Tales", seriesIndex: "3" });
    expect(info.cover).toMatchObject({ path: "OEBPS/cover.png", mediaType: "image/png" });
  });
});

describe("writing them back", () => {
  const changes = { title: "Sketch of the Analytical Engine", authors: ["L. F. Menabrea", "Ada Lovelace"], series: "Classic Papers", seriesIndex: "1", language: "en-GB", publisher: "Taylor & Francis", date: "1843", description: "With notes <by the translator>.", subjects: ["Computing", "History"] };

  it("replaces only the details changed, and keeps the rest of the package file", () => {
    const opf = rewriteOpf(EPUB3_OPF, 3, changes, new Date(Date.UTC(2026, 0, 2, 3, 4, 5)));
    expect(() => parseXml(opf)).not.toThrow();
    expect(opf).toContain('<dc:identifier id="bookid">urn:uuid:1234</dc:identifier>');
    expect(opf).toContain('<meta property="rendition:layout">reflowable</meta>');
    expect(opf).toContain('<meta property="dcterms:modified">2026-01-02T03:04:05Z</meta>');
    expect(opf).not.toContain("2020-01-01");
    expect(opf).not.toContain("Notes on the Engine");
    expect(opf).not.toContain('id="c1">Computing');
    expect(opf).toContain('<dc:creator id="creator2">Ada Lovelace</dc:creator>');
    expect(opf).toContain("<dc:description>With notes &lt;by the translator&gt;.</dc:description>");
    expect(opf).toContain('<meta refines="#series" property="group-position">1</meta>');
    expect(opf.match(/property="role"/g)).toHaveLength(2);
  });

  it("writes a book that reads back with the new details, mimetype first and stored", () => {
    for (const [opf, cover] of [
      [EPUB3_OPF, "images/cover.jpg"],
      [EPUB2_OPF, "cover.png"],
    ]) {
      const written = writeEpub(book(opf, cover), changes, { bytes: new Uint8Array([9, 9, 9]), mediaType: "image/webp" });
      // The first local file header: its name is mimetype and its compression method is 0, stored.
      expect(new TextDecoder().decode(written.subarray(30, 38))).toBe("mimetype");
      expect(written[8] | (written[9] << 8)).toBe(0);
      const files = unzipSync(written);
      const info = readEpubInfo(files);
      expect(info.metadata).toEqual(changes);
      expect(info.cover?.mediaType).toBe("image/webp");
      expect(Array.from(files[info.cover!.path])).toEqual([9, 9, 9]);
      expect(new TextDecoder().decode(files["OEBPS/one.xhtml"])).toBe("<html><body><p>One.</p></body></html>");
      expect(readPackage(new TextDecoder().decode(files[info.opfPath]), info.opfPath)).toMatchObject({ title: changes.title, authors: changes.authors, language: "en-GB" });
    }
  });
});
