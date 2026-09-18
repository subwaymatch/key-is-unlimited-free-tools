import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildXlsx, columnIndex, columnLetter, escapeXml, isDateFormat, parseCellRef, readDateStyles, readSharedStrings, readSheetXml, readXlsx, serialToText, sheetName, unescapeXml, uniqueSheetNames } from "@/lib/data/xlsx";

describe("cells and columns", () => {
  it("names columns the way Excel does, and back", () => {
    for (const [index, letters] of [[0, "A"], [25, "Z"], [26, "AA"], [27, "AB"], [701, "ZZ"], [702, "AAA"], [16383, "XFD"]] as const) {
      expect(columnLetter(index)).toBe(letters);
      expect(columnIndex(letters)).toBe(index);
    }
    expect(parseCellRef("B3")).toEqual({ column: 1, row: 2 });
    expect(parseCellRef("AA100")).toEqual({ column: 26, row: 99 });
    expect(parseCellRef("nope")).toBeNull();
  });

  it("escapes and unescapes XML, dropping what Excel refuses", () => {
    expect(escapeXml('a<b>&"c"\t')).toBe("a&lt;b&gt;&amp;&quot;c&quot;\t");
    expect(unescapeXml("a&lt;b&gt;&amp;&quot;&apos;&#65;&#x42;")).toBe("a<b>&\"'AB");
  });

  it("makes sheet names Excel accepts, told apart when they clash", () => {
    expect(sheetName("report: Q1/Q2 [final]?")).toBe("report Q1 Q2 final");
    expect(sheetName("")).toBe("Sheet1");
    expect(sheetName("a".repeat(40))).toHaveLength(31);
    expect(uniqueSheetNames(["data", "Data", "other", "data"])).toEqual(["data", "Data (2)", "other", "data (3)"]);
  });
});

describe("writing and reading a workbook", () => {
  it("round-trips rows through the ZIP, with numbers and booleans typed", () => {
    const rows = [
      ["name", "n", "ok", "note"],
      ["Ada", "42", "true", 'said "hi" & left'],
      ["Bob", "1.5", "FALSE", "two\nlines"],
      ["", "", "", ""],
      ["Cy", "007", "", "<tag>"],
    ];
    const bytes = buildXlsx([{ name: "people", rows }, { name: "people", rows: [["x"]] }], { typed: true, boldHeader: true });
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
    const sheet = new TextDecoder().decode(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('<c r="B2"><v>42</v></c>');
    expect(sheet).toContain('<c r="C2" t="b"><v>1</v></c>');
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(sheet).toContain("&quot;hi&quot; &amp; left");
    // Leading zeros stay text, and an empty row is written empty.
    expect(sheet).toContain('<c r="B5" t="inlineStr"><is><t xml:space="preserve">007</t></is></c>');
    expect(sheet).toContain('<row r="4"></row>');

    const workbook = readXlsx(bytes);
    expect(workbook.sheets.map((entry) => entry.name)).toEqual(["people", "people (2)"]);
    expect(workbook.sheets[0].rows).toEqual([
      ["name", "n", "ok", "note"],
      ["Ada", "42", "TRUE", 'said "hi" & left'],
      ["Bob", "1.5", "FALSE", "two\nlines"],
      ["", "", "", ""],
      ["Cy", "007", "", "<tag>"],
    ]);
  });

  it("refuses what is not a workbook, with the reason", () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow(/not an .xlsx workbook/);
    const notWorkbook = zipSync({ "hello.txt": strToU8("hi") });
    expect(() => readXlsx(notWorkbook)).toThrow(/not an Excel workbook/);
  });
});

describe("dates", () => {
  it("knows which formats show a date", () => {
    expect(isDateFormat(14, undefined)).toBe(true);
    expect(isDateFormat(0, undefined)).toBe(false);
    expect(isDateFormat(164, "yyyy-mm-dd")).toBe(true);
    expect(isDateFormat(164, "[$-409]d-mmm-yy;@")).toBe(true);
    expect(isDateFormat(164, "h:mm AM/PM")).toBe(true);
    expect(isDateFormat(164, "#,##0.00")).toBe(false);
    expect(isDateFormat(164, '"Day" 0')).toBe(false);
    expect(isDateFormat(164, "General")).toBe(false);
  });

  it("turns serials into dates, with Excel's phantom leap day", () => {
    expect(serialToText(1, false)).toBe("1900-01-01");
    expect(serialToText(59, false)).toBe("1900-02-28");
    expect(serialToText(60, false)).toBe("1900-02-29");
    expect(serialToText(61, false)).toBe("1900-03-01");
    expect(serialToText(45292, false)).toBe("2024-01-01");
    expect(serialToText(45292.5, false)).toBe("2024-01-01 12:00:00");
    expect(serialToText(0.75, false)).toBe("18:00:00");
    expect(serialToText(0, true)).toBe("1904-01-01");
    expect(serialToText(43830, true)).toBe("2024-01-01");
  });

  it("reads a sheet the way Excel writes one: shared strings, styles, gaps", () => {
    const shared = readSharedStrings('<sst count="2"><si><t>Name</t></si><si><r><t>Bo</t></r><r><t xml:space="preserve">b_x000D_</t></r></si></sst>');
    expect(shared).toEqual(["Name", "Bob\r"]);
    const dateStyles = readDateStyles('<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>');
    expect([...dateStyles]).toEqual([1, 2]);
    const xml = [
      "<worksheet><sheetData>",
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>When</t></is></c></row>',
      '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>3.5</v></c><c r="C3" s="1"><v>45292</v></c><c r="D3" t="b"><v>1</v></c><c r="E3" t="e"><v>#N/A</v></c><c r="F3" s="2"/></row>',
      '<row r="4"><c r="A4" t="str"><f>A3</f><v>Bob</v></c><c r="B4"><v>1E-3</v></c></row>',
      "</sheetData></worksheet>",
    ].join("");
    expect(readSheetXml(xml, shared, dateStyles, false)).toEqual([
      ["Name", "", "When", "", ""],
      ["", "", "", "", ""],
      ["Bob\r", "3.5", "2024-01-01", "TRUE", "#N/A"],
      ["Bob", "0.001", "", "", ""],
    ]);
  });
});
