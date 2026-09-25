/**
 * An Outlook message built from its parts for the .msg reader's tests: the
 * streams and storages [MS-OXMSG] names, in the compound file the test
 * writer makes.
 */
import { filetime, fixedProps, prop, utf16, writeCfb, type CfbNode } from "./cfbWriter";

const STRING = 0x001f;
const STRING8 = 0x001e;
const BINARY = 0x0102;
const LONG = 0x0003;
const TIME = 0x0040;

export const SENT = new Date(Date.UTC(2026, 8, 1, 9, 30, 0));

/** A picture over the 4096-byte cutoff, so it is stored in ordinary sectors. */
export const BIG_ATTACHMENT = Uint8Array.from({ length: 6000 }, (_, index) => (index * 7) % 256);

function recipient(index: number, name: string, address: string, type: number): CfbNode {
  return {
    name: `__recip_version1.0_#${index.toString(16).padStart(8, "0").toUpperCase()}`,
    children: [prop(0x3001, STRING, utf16(name)), prop(0x39fe, STRING, utf16(address)), fixedProps(8, [{ id: 0x0c15, type: LONG, value: type }])],
  };
}

function attachment(index: number, children: CfbNode[]): CfbNode {
  return { name: `__attach_version1.0_#${index.toString(16).padStart(8, "0").toUpperCase()}`, children };
}

export function sampleMsg(): Uint8Array {
  const nested: CfbNode[] = [prop(0x0037, STRING, utf16("Earlier thread")), prop(0x1000, STRING, utf16("The quoted message.")), fixedProps(24, [])];
  return writeCfb([
    prop(0x0037, STRING, utf16("Quarterly r\u00e9sum\u00e9")),
    prop(0x0c1a, STRING, utf16("Ada Lovelace")),
    prop(0x5d01, STRING, utf16("ada@example.com")),
    prop(0x0e04, STRING, utf16("Charles Babbage")),
    prop(0x1000, STRING, utf16("Hello Charles,\r\n\r\nThe figures are attached.\r\n")),
    prop(0x1013, BINARY, new TextEncoder().encode('<html><body><p>Hello <b>Charles</b>,</p><img src="cid:chart@x"><script>alert(1)</script></body></html>')),
    prop(0x007d, STRING8, new TextEncoder().encode("Message-ID: <abc123@example.com>\r\nDate: Tue, 1 Sep 2026 09:30:00 +0000\r\nX-Mailer:\r\n folded value\r\n")),
    fixedProps(32, [
      { id: 0x0039, type: TIME, value: filetime(SENT) },
      { id: 0x3fde, type: LONG, value: 65001 },
    ]),
    recipient(0, "Charles Babbage", "charles@example.com", 1),
    recipient(1, "Mary Somerville", "mary@example.com", 2),
    attachment(0, [prop(0x3707, STRING, utf16("figures.csv")), prop(0x370e, STRING, utf16("text/csv")), prop(0x3701, BINARY, new TextEncoder().encode("quarter,total\nQ1,10\n")), fixedProps(8, [{ id: 0x3705, type: LONG, value: 1 }])]),
    attachment(1, [prop(0x3707, STRING, utf16("chart.png")), prop(0x370e, STRING, utf16("image/png")), prop(0x3712, STRING, utf16("chart@x")), prop(0x3701, BINARY, BIG_ATTACHMENT), fixedProps(8, [{ id: 0x3705, type: LONG, value: 1 }, { id: 0x3714, type: LONG, value: 4 }])]),
    attachment(2, [prop(0x3001, STRING, utf16("Earlier thread")), { name: "__substg1.0_3701000D", children: nested }, fixedProps(8, [{ id: 0x3705, type: LONG, value: 5 }])]),
  ]);
}
