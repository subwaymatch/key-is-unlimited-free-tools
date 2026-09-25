import { describe, expect, it } from "vitest";

import { anonymizeRows, detectColumns, hasher, headerKind, luhn, maskValue, masker, pseudonymizer, valueKind } from "@/lib/data/anonymize";
import { formatNumber, parseNumber, pivotTable, PivotError } from "@/lib/data/pivot";
import { compareTables, joinTables, keyColumns, RelateError } from "@/lib/data/relate";

const customers = [
  ["id", "name", "city"],
  ["1", "Ada", "London"],
  ["2", "Charles", "London"],
  ["3", "Mary", "Burntisland"],
];

const orders = [
  ["Customer ID", "total", "city"],
  ["1", "10", "Paris"],
  ["1", "15", "Paris"],
  [" 3 ", "7", "Leeds"],
  ["9", "99", "Nowhere"],
];

describe("joining", () => {
  it("keeps every first-file row, as VLOOKUP does, and repeats a row per match", () => {
    const result = joinTables(customers, orders, "left", { leftKey: "id", rightKey: "customer id", ignoreCase: true });
    expect(result.rows).toEqual([
      ["id", "name", "city", "total", "city (2)"],
      ["1", "Ada", "London", "10", "Paris"],
      ["1", "Ada", "London", "15", "Paris"],
      ["2", "Charles", "London", "", ""],
      ["3", "Mary", "Burntisland", "7", "Leeds"],
    ]);
    expect(result).toMatchObject({ matched: 2, unmatchedLeft: 1, unmatchedRight: 1, repeatedKeys: 1, keyName: "id" });
  });

  it("does inner and full joins", () => {
    expect(joinTables(customers, orders, "inner", { leftKey: "1", rightKey: "1", ignoreCase: false }).rows).toHaveLength(4);
    const full = joinTables(customers, orders, "full", { leftKey: "id", rightKey: "Customer ID", ignoreCase: false });
    expect(full.rows[full.rows.length - 1]).toEqual(["9", "", "", "99", "Nowhere"]);
  });

  it("finds a shared column name when none is given, and says when there is none", () => {
    expect(keyColumns(["a", "City"], ["city", "b"], { leftKey: "", rightKey: "", ignoreCase: false })).toEqual({ left: 1, right: 0 });
    expect(() => keyColumns(["a"], ["b"], { leftKey: "", rightKey: "", ignoreCase: false })).toThrow(RelateError);
    expect(() => keyColumns(["a"], ["b"], { leftKey: "zzz", rightKey: "", ignoreCase: false })).toThrow(/no column "zzz"/);
  });
});

describe("comparing", () => {
  const before = [
    ["sku", "price", "stock"],
    ["A", "1.00", "5"],
    ["B", "2.00", "0"],
    ["C", "3.00", "1"],
  ];
  const after = [
    ["sku", "price", "stock", "colour"],
    ["A", "1.00", "5", ""],
    ["C", "3.50", "1", "red"],
    ["D", "4.00", "9", "blue"],
  ];

  it("reports added, removed and changed rows by key, with the changed cells", () => {
    const result = compareTables(before, after, "key", { leftKey: "", rightKey: "", ignoreCase: false });
    expect(result).toMatchObject({ added: 1, removed: 1, changed: 1, unchanged: 1, keyName: "sku" });
    expect(result.rows).toEqual([
      ["change", "changed columns", "sku", "price", "stock", "colour"],
      ["removed", "", "B", "2.00", "0", ""],
      ["changed", "price, colour", "C", "3.00 -> 3.50", "1", " -> red"],
      ["added", "", "D", "4.00", "9", "blue"],
    ]);
  });

  it("compares whole rows when there is no key, counting repeats", () => {
    const a = [["x"], ["1"], ["1"], ["2"]];
    const b = [["x"], ["1"], ["3"]];
    const result = compareTables(a, b, "row", { leftKey: "", rightKey: "", ignoreCase: false });
    expect(result).toMatchObject({ added: 1, removed: 2, unchanged: 1 });
    expect(result.rows.slice(1)).toEqual([["added", "", "3"], ["removed", "", "1"], ["removed", "", "2"]]);
  });
});

describe("pivot tables", () => {
  const sales = [
    ["region", "month", "amount"],
    ["North", "Jan", "10"],
    ["North", "Feb", "1,000.50"],
    ["South", "Jan", "$5"],
    ["South", "Jan", "n/a"],
    ["", "Feb", "1"],
  ];

  it("reads numbers the way people write them", () => {
    expect(parseNumber(" 1,234.5 ")).toBe(1234.5);
    expect(parseNumber("(12)")).toBe(-12);
    expect(parseNumber("\u20ac3")).toBe(3);
    expect(parseNumber("1,23")).toBeNull();
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
  });

  it("sums by group with a total, leaving out cells that are not numbers", () => {
    const result = pivotTable(sales, { rows: "region", columns: "", values: "amount", aggregate: "sum" });
    expect(result.table).toEqual([
      ["region", "Sum of amount"],
      ["North", "1010.5"],
      ["South", "5"],
      ["(blank)", "1"],
      ["Total", "1016.5"],
    ]);
    expect(result.skipped).toBe(1);
  });

  it("spreads a second column across, with row and column totals", () => {
    const result = pivotTable(sales, { rows: "1", columns: "month", values: "", aggregate: "count" });
    expect(result.table).toEqual([
      ["region / month", "Feb", "Jan", "Total"],
      ["North", "1", "1", "2"],
      ["South", "0", "2", "2"],
      ["(blank)", "1", "0", "1"],
      ["Total", "2", "3", "5"],
    ]);
    expect(pivotTable(sales, { rows: "region", columns: "", values: "amount", aggregate: "mean" }).table[1]).toEqual(["North", "505.25"]);
    expect(pivotTable(sales, { rows: "month", columns: "", values: "region", aggregate: "distinct" }).table[1]).toEqual(["Feb", "1"]);
  });

  it("names the column it could not find", () => {
    expect(() => pivotTable(sales, { rows: "country", columns: "", values: "", aggregate: "count" })).toThrow(PivotError);
  });
});

describe("anonymising", () => {
  const people = [
    ["Full name", "Contact", "tel", "notes", "Card", "joined", "id"],
    ["Ada Lovelace", "ada@example.org", "+44 20 7946 0000", "Call 020 7946 0001 or mail a.l@ex.co.uk", "4111 1111 1111 1111", "1843-01-01", "7"],
    ["Charles Babbage", "cb@example.org", "+44 20 7946 0002", "", "5500 0000 0000 0004", "1823-06-14", "8"],
    ["Ada Lovelace", "ADA@example.org ", "", "no contact", "", "", "9"],
  ];

  it("recognises personal data by header and by content", () => {
    expect(headerKind("E-Mail Address")).toBe("email");
    expect(headerKind("first_name")).toBe("name");
    expect(headerKind("product name")).toBeNull();
    expect(headerKind("Date of Birth")).toBe("birth");
    expect(valueKind("192.168.0.1")).toBe("ip");
    expect(valueKind("2024-01-15")).toBeNull();
    expect(valueKind("12345678")).toBeNull();
    expect(luhn("4111111111111111")).toBe(true);
    const detected = detectColumns(people, "joined", "id");
    expect(detected.map((entry) => [people[0][entry.index], entry.kind, entry.how])).toEqual([
      ["Full name", "name", "header"],
      ["Contact", "email", "content"],
      ["tel", "phone", "header"],
      ["Card", "card", "content"],
      ["joined", "other", "chosen"],
    ]);
  });

  it("replaces with consistent stand-ins, and scrubs text columns", () => {
    const targets = detectColumns(people, "", "");
    const result = anonymizeRows(people, targets, "pseudonym", pseudonymizer(), true);
    expect(result.rows[1].slice(0, 5)).toEqual(["Person 1", "user1@example.com", "555-0001", "Call 555-0002 or mail user2@example.com", "Card 1"]);
    expect(result.rows[3].slice(0, 2)).toEqual(["Person 1", "user1@example.com"]);
    expect(result.rows[1][5]).toBe("1843-01-01");
    expect(result.scrubbed).toBe(2);
  });

  it("masks, hashes and removes", () => {
    expect(maskValue("ada@example.org", "email")).toBe("a***@e***.org");
    expect(maskValue("Ada Lovelace", "name")).toBe("A*** L***");
    expect(maskValue("4111 1111 1111 1111", "card")).toBe("**** **** **** 1111");
    expect(maskValue("1985-03-02", "birth")).toBe("1985");
    expect(maskValue("10.1.2.3", "ip")).toBe("10.1.*.*");
    const targets = detectColumns(people, "", "");
    const masked = anonymizeRows(people, targets, "mask", masker(), false);
    expect(masked.rows[2][2]).toBe("+** ** **** 0002");
    const hashed = anonymizeRows(people, targets, "hash", hasher("salt"), false);
    expect(hashed.rows[1][1]).toMatch(/^[0-9a-f]{16}$/);
    expect(hashed.rows[1][1]).toBe(hashed.rows[3][1]);
    expect(hashed.rows[1][1]).not.toBe(anonymizeRows(people, targets, "hash", hasher("other"), false).rows[1][1]);
    const removed = anonymizeRows(people, targets, "remove", masker(), false);
    expect(removed.rows[0]).toEqual(["notes", "joined", "id"]);
    expect(removed.replaced).toBe(10);
  });
});
