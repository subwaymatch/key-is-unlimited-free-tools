import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { cellOf, isSqlite, parseCreateTable, SqliteDatabase, SqliteError } from "@/lib/data/sqlite";

/*
 * Databases written by SQLite itself, through Node's built-in binding, so
 * the reader is checked against the real file format rather than against
 * an idea of it.
 */
interface SqliteBinding {
  DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void };
}
// @types/node 20 predates node:sqlite; Node 22, which CI and the tests run on, has it.
const bindingName = "node:sqlite";
const { DatabaseSync } = (await import(/* @vite-ignore */ bindingName)) as SqliteBinding;
const directory = mkdtempSync(join(tmpdir(), "sqlite-reader-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function database(name: string, statements: string[], pragmas: string[] = []): Uint8Array {
  const path = join(directory, name);
  const db = new DatabaseSync(path);
  for (const pragma of pragmas) db.exec(pragma);
  for (const statement of statements) db.exec(statement);
  db.close();
  return new Uint8Array(readFileSync(path));
}

function rows(bytes: Uint8Array, table: string): string[][] {
  const db = new SqliteDatabase(bytes);
  const found = db.tables().find((entry) => entry.name === table);
  if (!found) throw new Error(`no table ${table}`);
  return Array.from(db.tableRows(found), (row) => row.map(cellOf));
}

describe("reading SQLite databases", () => {
  it("reads every storage class, the rowid alias and NULLs", () => {
    const bytes = database("types.db", [
      "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL, big INTEGER, photo BLOB, note TEXT)",
      "INSERT INTO people VALUES (1, 'Ada', 3.5, 9007199254740993, x'00ff10', NULL)",
      "INSERT INTO people VALUES (7, 'Zo\u00eb \u65e5\u672c', -0.25, -129, NULL, 'x')",
      "INSERT INTO people (name, big) VALUES ('Next', 70000)",
      "CREATE INDEX people_name ON people(name)",
      "CREATE VIEW everyone AS SELECT * FROM people",
    ]);
    expect(isSqlite(bytes)).toBe(true);
    const db = new SqliteDatabase(bytes);
    expect(db.tables().map((table) => [table.name, table.columns])).toEqual([["people", ["id", "name", "score", "big", "photo", "note"]]]);
    expect(rows(bytes, "people")).toEqual([
      ["1", "Ada", "3.5", "9007199254740993", "00ff10", ""],
      ["7", "Zo\u00eb \u65e5\u672c", "-0.25", "-129", "", "x"],
      ["8", "Next", "", "70000", "", ""],
    ]);
  });

  it("walks interior pages and overflow chains", () => {
    const long = "x".repeat(20_000);
    const statements = ["CREATE TABLE log (n INTEGER, body TEXT)", "BEGIN"];
    for (let n = 0; n < 3000; n += 1) statements.push(`INSERT INTO log VALUES (${n}, 'line ${n}')`);
    statements.push(`INSERT INTO log VALUES (3000, '${long}')`, "COMMIT");
    const bytes = database("big.db", statements, ["PRAGMA page_size = 1024"]);
    const all = rows(bytes, "log");
    expect(all).toHaveLength(3001);
    expect(all[1234]).toEqual(["1234", "line 1234"]);
    expect(all[3000][1]).toBe(long);
  });

  it("reads WITHOUT ROWID tables in their declared column order", () => {
    const bytes = database("norowid.db", [
      'CREATE TABLE "stock levels" ("store name" TEXT, sku TEXT, qty INT, PRIMARY KEY (sku, "store name")) WITHOUT ROWID',
      "BEGIN",
      ...Array.from({ length: 400 }, (_, index) => `INSERT INTO "stock levels" VALUES ('store ${index % 3}', 'sku-${String(index).padStart(4, "0")}', ${index})`),
      "COMMIT",
    ], ["PRAGMA page_size = 512"]);
    const db = new SqliteDatabase(bytes);
    const table = db.tables()[0];
    expect(table).toMatchObject({ name: "stock levels", columns: ["store name", "sku", "qty"], withoutRowid: true });
    const all = rows(bytes, "stock levels");
    expect(all).toHaveLength(400);
    expect(all[0]).toEqual(["store 0", "sku-0000", "0"]);
    expect(all[399]).toEqual(["store 0", "sku-0399", "399"]);
  });

  it("fills columns added later with NULL, and skips virtual generated columns", () => {
    const bytes = database("altered.db", [
      "CREATE TABLE t (a INTEGER, b TEXT, c INTEGER GENERATED ALWAYS AS (a * 2) VIRTUAL, d INTEGER AS (a + 1) STORED)",
      "INSERT INTO t (a, b) VALUES (1, 'one')",
      "ALTER TABLE t ADD COLUMN e TEXT",
      "INSERT INTO t (a, b, e) VALUES (2, 'two', 'new')",
    ]);
    expect(rows(bytes, "t")).toEqual([
      ["1", "one", "", "2", ""],
      ["2", "two", "", "3", "new"],
    ]);
  });

  it("reads a UTF-16 database", () => {
    const bytes = database("utf16.db", ["CREATE TABLE words (w TEXT)", "INSERT INTO words VALUES ('caf\u00e9'), ('\u65e5\u672c\u8a9e')"], ["PRAGMA encoding = 'UTF-16le'"]);
    expect(new SqliteDatabase(bytes).encoding).toBe("utf-16le");
    expect(rows(bytes, "words")).toEqual([["caf\u00e9"], ["\u65e5\u672c\u8a9e"]]);
  });

  it("refuses what is not a database", () => {
    expect(() => new SqliteDatabase(new TextEncoder().encode("not a database at all, just text".repeat(10)))).toThrow(SqliteError);
  });
});

describe("CREATE TABLE statements", () => {
  it("finds the columns, the rowid alias and the primary key", () => {
    expect(parseCreateTable('CREATE TABLE x ([my col] TEXT DEFAULT \'a,b\', `n` INTEGER PRIMARY KEY AUTOINCREMENT, "q""uote" CHECK (length(q) > 0), CONSTRAINT u UNIQUE (n))')).toEqual({
      columns: [
        { name: "my col", rowidAlias: false, stored: true },
        { name: "n", rowidAlias: true, stored: true },
        { name: 'q"uote', rowidAlias: false, stored: true },
      ],
      primaryKey: ["n"],
      withoutRowid: false,
    });
    expect(parseCreateTable("CREATE TABLE y (id INT PRIMARY KEY, v)").columns[0].rowidAlias).toBe(false);
  });
});
