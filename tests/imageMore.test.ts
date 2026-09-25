import { describe, expect, it } from "vitest";

import { mmToPixels, PHOTO_SPECS, photoCrop, setJpegDpi, SHEET_SPECS, sheetLayout } from "@/lib/images/passport";
import { cleanSvg, DEFAULT_SVG_OPTIONS, describeCleaning, roundNumbers } from "@/lib/images/svgClean";
import { parseXml } from "@/lib/text/xml";

const INKSCAPE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape (http://www.inkscape.org/) -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   width="100mm" height="50.000001mm" viewBox="0 0 100.00000 50.000001" id="svg8" inkscape:version="1.2" sodipodi:docname="logo.svg" onload="alert(1)">
  <sodipodi:namedview id="base" pagecolor="#ffffff" inkscape:zoom="1.4"/>
  <metadata id="metadata5"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></metadata>
  <defs id="defs2"><linearGradient id="grad"><stop offset="0.500000" stop-color="#f00"/></linearGradient></defs>
  <title>Logo</title>
  <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1">
    <path d="M 10.123456,20.987654 L 30.5 , 40.25 C 1.0000001 2 3 -4.4444 5 6 Z" style="fill:url(#grad)" id="path10"/>
    <circle cx="50.0000" cy="25.12345678" r="10" id="circle12" />
    <a xlink:href="javascript:alert(2)"><rect x="0" y="0" width="5" height="5"/></a>
    <text x="1" y="2"><tspan>Hello</tspan> <tspan>world</tspan></text>
    <g id="empty"></g>
    <g></g>
  </g>
  <script>alert(3)</script>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
</svg>`;

describe("cleaning SVG", () => {
  it("rounds numbers and packs path data", () => {
    expect(roundNumbers("M 10.123456,20.987654 L 30.5 , 40.25 C 1.0000001 2 3 -4.4444 5 6 Z", 3, true)).toBe("M10.123 20.988L30.5 40.25C1 2 3-4.444 5 6Z");
    expect(roundNumbers("0 0 100.00000 50.000001", 3, false)).toBe("0 0 100 50");
    expect(roundNumbers("0.5 -0.25", 2, false)).toBe(".5 -.25");
  });

  it("takes out editor data, metadata, comments, unused ids and anything that runs", () => {
    const { svg, counts } = cleanSvg(INKSCAPE, DEFAULT_SVG_OPTIONS);
    expect(svg).not.toContain("inkscape");
    expect(svg).not.toContain("sodipodi");
    expect(svg).not.toContain("metadata");
    expect(svg).not.toContain("<!--");
    expect(svg).not.toContain("<?xml");
    expect(svg).not.toContain("alert");
    expect(svg).not.toContain("foreignObject");
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100mm" height="50mm" viewBox="0 0 100 50">');
    expect(svg).toContain('<linearGradient id="grad"><stop offset=".5" stop-color="#f00"/></linearGradient>');
    expect(svg).toContain('<path d="M10.123 20.988L30.5 40.25C1 2 3-4.444 5 6Z" style="fill:url(#grad)"/>');
    expect(svg).toContain('<circle cx="50" cy="25.123" r="10"/>');
    expect(svg).toContain("<title>Logo</title>");
    expect(svg).toContain("<text x=\"1\" y=\"2\"><tspan>Hello</tspan> <tspan>world</tspan></text>");
    // An empty group goes once nothing refers to its id.
    expect(svg).not.toContain("empty");
    expect(counts).toMatchObject({ comments: 1, metadata: 1, scripts: 2, handlers: 2, emptyGroups: 2 });
    expect(counts.unusedIds).toBe(6);
    expect(describeCleaning(counts)).toContain("1 comment");
    expect(parseXml(svg).root.name).toBe("svg");
  });

  it("keeps ids when a stylesheet could use them, and titles only if asked", () => {
    const withStyle = '<svg xmlns="http://www.w3.org/2000/svg"><style>#a{fill:red}</style><rect id="a"/><rect id="b"/><title>T</title></svg>';
    const { svg } = cleanSvg(withStyle, { precision: null, sanitize: true, keepTitles: false });
    expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"><style>#a{fill:red}</style><rect id="a"/><rect id="b"/></svg>');
  });

  it("refuses XML that is not an SVG", () => {
    expect(() => cleanSvg("<html/>", DEFAULT_SVG_OPTIONS)).toThrow(/not <svg>/);
  });
});

describe("passport photo sheets", () => {
  const [uk, us, canada] = PHOTO_SPECS;
  const [print, a4] = SHEET_SPECS;

  it("fits as many photos as the sheet holds, whichever way round", () => {
    const ukOnPrint = sheetLayout(print, uk);
    expect([ukOnPrint.columns, ukOnPrint.rows, ukOnPrint.landscape]).toEqual([4, 2, true]);
    expect(ukOnPrint.sheet).toEqual({ width: 1800, height: 1200 });
    expect(ukOnPrint.photo).toEqual({ width: 413, height: 531 });
    expect(ukOnPrint.cells).toHaveLength(8);
    const usOnPrint = sheetLayout(print, us);
    expect([usOnPrint.columns, usOnPrint.rows, usOnPrint.cells.length]).toEqual([2, 3, 6]);
    expect(usOnPrint.cells[1].x - usOnPrint.cells[0].x).toBe(usOnPrint.photo.width);
    // Butted together, sixteen fit on A4 with 5 mm to spare at the sides; spaced out, twelve would.
    expect(sheetLayout(a4, canada).cells).toHaveLength(16);
    for (const cell of ukOnPrint.cells) {
      expect(cell.x).toBeGreaterThanOrEqual(mmToPixels(3));
      expect(cell.x + ukOnPrint.photo.width).toBeLessThanOrEqual(ukOnPrint.sheet.width - mmToPixels(3) + 1);
      expect(cell.y + ukOnPrint.photo.height).toBeLessThanOrEqual(ukOnPrint.sheet.height);
    }
  });

  it("cuts the photo's shape from the picture, nearer the top than the bottom", () => {
    expect(photoCrop({ width: 3000, height: 4000 }, uk)).toEqual({ x: 0, y: 50, width: 3000, height: 3857 });
    expect(photoCrop({ width: 4000, height: 3000 }, us)).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
  });

  it("writes a resolution into a JPEG's JFIF header, and leaves anything else alone", () => {
    const jfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
    const out = setJpegDpi(jfif, 300);
    expect(Array.from(out.subarray(13, 18))).toEqual([1, 1, 44, 1, 44]);
    expect(Array.from(jfif.subarray(13, 18))).toEqual([0, 0, 1, 0, 1]);
    const exif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
    expect(setJpegDpi(exif, 300)).toEqual(exif);
  });
});
