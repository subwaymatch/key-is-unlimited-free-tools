import { describe, expect, it } from "vitest";

import { attribute, children, decodeEntities, descendants, describeXml, formatXml, jsonToXml, parseXml, textContent, XmlError, xmlName, xmlToJson } from "@/lib/text/xml";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- a catalogue -->
<!DOCTYPE catalogue [ <!ENTITY pub "Publisher"> ]>
<catalogue xmlns:dc="http://purl.org/dc/elements/1.1/"><book id="b1" lang='en'><dc:title>Tom &amp; Jerry</dc:title>
<price>9.50</price><p>A <b>bold</b> move &#x2014; really.</p><empty/><note><![CDATA[<raw> & stuff]]></note></book>
<book id="b2"><dc:title>Second</dc:title><price>12</price></book></catalogue>`;

describe("reading XML", () => {
  it("reads elements, attributes, text, CDATA, comments and the doctype", () => {
    const document = parseXml(SAMPLE);
    expect(document.root.name).toBe("catalogue");
    expect(document.children.map((node) => node.type)).toEqual(["instruction", "text", "comment", "text", "doctype", "text", "element"]);
    const books = children(document.root, "book");
    expect(books).toHaveLength(2);
    expect(attribute(books[0], "lang")).toBe("en");
    expect(textContent(children(books[0], "title")[0])).toBe("Tom & Jerry");
    expect(textContent(children(books[0], "p")[0])).toBe("A bold move \u2014 really.");
    expect(textContent(children(books[0], "note")[0])).toBe("<raw> & stuff");
    expect(descendants(document.root, "price").map(textContent)).toEqual(["9.50", "12"]);
    expect(describeXml(document)).toEqual({ elements: 11, depth: 4 });
  });

  it("keeps unknown entities as written and expands the HTML ones e-books use", () => {
    expect(decodeEntities("a&nbsp;b &pub; &#65;&lt;")).toBe("a\u00a0b &pub; A<");
  });

  it("says where a file breaks", () => {
    const cases: [string, RegExp, number, number][] = [
      ["<a><b></a>", /does not match <b>/, 1, 7],
      ["<a>\n  <b>fish & chips</b></a>", /bare &/, 2, 11],
      ["<a x=1/>", /not in quotes/, 1, 6],
      ["<a x='1' x='2'/>", /appears twice/, 1, 10],
      ["<a/><b/>", /second root/, 1, 5],
      ["<a>", /never closed/, 1, 1],
      ["hello <a/>", /text before the root/, 1, 1],
      ["<a><!-- open", /comment is never closed/, 1, 4],
      ["<a checked/>", /has no value/, 1, 4],
      ["", /no root element/, 1, 1],
    ];
    for (const [text, message, line, column] of cases) {
      let caught: unknown = null;
      try {
        parseXml(text);
      } catch (error) {
        caught = error;
      }
      expect(caught, text).toBeInstanceOf(XmlError);
      const problem = caught as XmlError;
      expect(problem.message, text).toMatch(message);
      expect([problem.line, problem.column], text).toEqual([line, column]);
    }
  });

  it("reads a byte-order mark and CRLF line endings", () => {
    expect(parseXml("\ufeff<a>\r\n<b/>\r\n</a>").root.name).toBe("a");
  });
});

describe("writing XML", () => {
  it("indents, keeping text and mixed content exactly as they were", () => {
    const formatted = formatXml(parseXml(SAMPLE), { indent: 2, dropComments: false });
    expect(formatted).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<!-- a catalogue -->",
        '<!DOCTYPE catalogue [ <!ENTITY pub "Publisher"> ]>',
        '<catalogue xmlns:dc="http://purl.org/dc/elements/1.1/">',
        '  <book id="b1" lang="en">',
        "    <dc:title>Tom &amp; Jerry</dc:title>",
        "    <price>9.50</price>",
        "    <p>A <b>bold</b> move &#x2014; really.</p>",
        "    <empty/>",
        "    <note><![CDATA[<raw> & stuff]]></note>",
        "  </book>",
        '  <book id="b2">',
        "    <dc:title>Second</dc:title>",
        "    <price>12</price>",
        "  </book>",
        "</catalogue>",
        "",
      ].join("\n"),
    );
  });

  it("minifies, drops comments on request, and reads its own output back", () => {
    const minified = formatXml(parseXml(SAMPLE), { indent: "none", dropComments: true });
    expect(minified).not.toContain("\n");
    expect(minified).not.toContain("catalogue -->");
    expect(minified).toContain('<book id="b2"><dc:title>Second</dc:title><price>12</price></book></catalogue>');
    expect(formatXml(parseXml(minified), { indent: "none", dropComments: true })).toBe(minified);
    const tabbed = formatXml(parseXml(minified), { indent: "tab", dropComments: false });
    expect(tabbed).toContain("\n\t<book");
  });

  it("leaves xml:space=preserve alone", () => {
    const text = '<a><pre xml:space="preserve">\n  one\n    two\n</pre></a>';
    expect(formatXml(parseXml(text), { indent: 2, dropComments: false })).toContain('<pre xml:space="preserve">\n  one\n    two\n</pre>');
  });
});

describe("XML and JSON", () => {
  it("writes attributes as @keys, repeats as arrays and text alone as a value", () => {
    const json = xmlToJson(parseXml(SAMPLE), { typed: true });
    const catalogue = json.catalogue as Record<string, unknown>;
    expect(catalogue["@xmlns:dc"]).toBe("http://purl.org/dc/elements/1.1/");
    const books = catalogue.book as Record<string, unknown>[];
    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({ "@id": "b1", "@lang": "en", "dc:title": "Tom & Jerry", price: "9.50", empty: "", note: "<raw> & stuff" });
    expect(books[0].p).toEqual({ b: "bold", "#text": "A  move \u2014 really." });
    expect(books[1].price).toBe(12);
    expect((xmlToJson(parseXml(SAMPLE), { typed: false }).catalogue as { book: { price: unknown }[] }).book[1].price).toBe("12");
  });

  it("writes JSON back as XML that reads as the same JSON", () => {
    const value = { library: { "@name": "City & Co", book: [{ "@id": 1, title: "A" }, { "@id": 2, title: "B <2>" }], open: true, closed: null } };
    const xml = jsonToXml(value);
    expect(xml).toContain('<library name="City &amp; Co">');
    expect(xml).toContain("<title>B &lt;2&gt;</title>");
    expect(xml).toContain("<closed/>");
    expect(xmlToJson(parseXml(xml), { typed: true })).toEqual({ library: { "@name": "City & Co", book: [{ "@id": 1, title: "A" }, { "@id": 2, title: "B <2>" }], open: true, closed: "" } });
  });

  it("wraps arrays and loose values, and makes names of keys that are not", () => {
    expect(jsonToXml([1, "two"], "list", "none")).toBe('<?xml version="1.0" encoding="UTF-8"?><list><item>1</item><item>two</item></list>');
    expect(xmlName("first name")).toBe("first_name");
    expect(xmlName("2nd")).toBe("_2nd");
    expect(xmlName("xmlThing")).toBe("_xmlThing");
    expect(jsonToXml({ a: 1, b: 2 }, "root", "none")).toBe('<?xml version="1.0" encoding="UTF-8"?><root><a>1</a><b>2</b></root>');
  });
});
