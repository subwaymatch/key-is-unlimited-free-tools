/**
 * A SQLite database read without SQLite: the file format walked by hand,
 * table by table, row by row.
 *
 * A database is a run of fixed-size pages. Every table is a B-tree of
 * them - interior pages pointing down, leaf pages holding rows as records
 * keyed by rowid - and the schema is itself a table, sqlite_schema, rooted
 * on page 1, whose rows name each table, its root page and the CREATE
 * TABLE statement the column names are read from. A row too long for its
 * page continues on a chain of overflow pages. A table declared WITHOUT
 * ROWID is stored as an index B-tree instead, with its primary key first.
 * All of it is in the file format document at sqlite.org, and nothing here
 * runs SQL.
 *
 * What this cannot see: changes still in a -wal file beside the database,
 * which SQLite has not yet copied in, and anything in an encrypted
 * database.
 */

export class SqliteError extends Error {}

export type SqliteValue = null | number | bigint | string | Uint8Array;

export interface SqliteTable {
  name: string;
  columns: string[];
  rootPage: number;
  withoutRowid: boolean;
  sql: string;
}

const HEADER = "SQLite format 3\u0000";

export function isSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false;
  for (let index = 0; index < 16; index += 1) if (bytes[index] !== HEADER.charCodeAt(index)) return false;
  return true;
}

/* ---- The CREATE TABLE statement ----------------------------------------- */

/** An identifier as written, its quotes taken off: "name", [name], `name` or name. */
function unquote(name: string): string {
  const first = name[0];
  if ((first === '"' || first === "`" || first === "'") && name.endsWith(first)) return name.slice(1, -1).split(first + first).join(first);
  if (first === "[" && name.endsWith("]")) return name.slice(1, -1);
  return name;
}

/** The pieces of a list at its top level, split at commas outside brackets and quotes. */
function splitTopLevel(text: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (quote) {
      current += ch;
      if (ch === (quote === "[" ? "]" : quote)) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`" || ch === "[") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      pieces.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

/** The first token of a column definition: its name, quoted or bare. */
function leadingName(definition: string): { name: string; rest: string } {
  const match = /^("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|'(?:[^']|'')*'|[^\s(]+)\s*([\s\S]*)$/.exec(definition.trim());
  return match ? { name: unquote(match[1]), rest: match[2] } : { name: definition.trim(), rest: "" };
}

export interface ParsedTable {
  columns: { name: string; rowidAlias: boolean; stored: boolean }[];
  primaryKey: string[];
  withoutRowid: boolean;
}

/**
 * The columns a CREATE TABLE declares, in order, and which of them is the
 * rowid under another name: a column declared exactly INTEGER PRIMARY KEY
 * is stored as a NULL in the record, its value being the row's key. A
 * generated column that is not STORED has no place in the record at all.
 */
export function parseCreateTable(sql: string): ParsedTable {
  const open = sql.indexOf("(");
  const close = sql.lastIndexOf(")");
  if (open < 0 || close < open) throw new SqliteError("A table's CREATE statement has no column list.");
  const withoutRowid = /\bwithout\s+rowid\b/i.test(sql.slice(close));
  const columns: ParsedTable["columns"] = [];
  let primaryKey: string[] = [];
  for (const definition of splitTopLevel(sql.slice(open + 1, close))) {
    const keyword = definition.toUpperCase();
    if (/^(CONSTRAINT\b|PRIMARY\s+KEY\b|UNIQUE\b|CHECK\b|FOREIGN\s+KEY\b)/.test(keyword)) {
      const key = /PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(definition);
      if (key) primaryKey = splitTopLevel(key[1]).map((entry) => unquote(entry.trim().split(/\s+/)[0]));
      continue;
    }
    const { name, rest } = leadingName(definition);
    const type = rest.match(/^[A-Za-z_]+(?:\s+[A-Za-z_]+)*?(?=\s|\(|$)/)?.[0] ?? "";
    const upper = rest.toUpperCase();
    const isPrimary = /\bPRIMARY\s+KEY\b/.test(upper);
    if (isPrimary) primaryKey = [name];
    const generated = /\bGENERATED\s+ALWAYS\s+AS\b|^\s*AS\s*\(|\)\s*AS\s*\(|\s AS\s*\(/.test(upper);
    columns.push({ name, rowidAlias: isPrimary && type.toUpperCase() === "INTEGER" && !/\bPRIMARY\s+KEY\s+DESC\b/.test(upper), stored: !generated || /\bSTORED\b/.test(upper) });
  }
  if (withoutRowid) for (const column of columns) column.rowidAlias = false;
  return { columns, primaryKey, withoutRowid };
}

/* ---- Pages and records --------------------------------------------------- */

export class SqliteDatabase {
  private readonly view: DataView;
  readonly pageSize: number;
  private readonly usable: number;
  readonly encoding: "utf-8" | "utf-16le" | "utf-16be";
  readonly pageCount: number;
  /** The database was last written in WAL mode, so recent changes may still be in its -wal file. */
  readonly wal: boolean;
  private readonly decoder: TextDecoder;

  constructor(private readonly bytes: Uint8Array) {
    if (!isSqlite(bytes)) throw new SqliteError("This is not a SQLite database: it does not start with the header every one does.");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = this.view.getUint16(16);
    this.pageSize = size === 1 ? 65536 : size;
    if (this.pageSize < 512 || (this.pageSize & (this.pageSize - 1)) !== 0) throw new SqliteError(`The page size, ${this.pageSize}, is not one SQLite writes.`);
    this.usable = this.pageSize - bytes[20];
    const encoding = this.view.getUint32(56);
    this.encoding = encoding === 2 ? "utf-16le" : encoding === 3 ? "utf-16be" : "utf-8";
    this.decoder = new TextDecoder(this.encoding);
    this.pageCount = Math.floor(bytes.length / this.pageSize);
    this.wal = bytes[18] === 2 || bytes[19] === 2;
  }

  private pageOffset(page: number): number {
    if (page < 1 || page > this.pageCount) throw new SqliteError(`A row points at page ${page}, which is past the end of the file; it is cut short or damaged.`);
    return (page - 1) * this.pageSize;
  }

  private varint(at: number): { value: number; length: number } {
    let value = 0;
    for (let index = 0; index < 8; index += 1) {
      const byte = this.bytes[at + index];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return { value, length: index + 1 };
    }
    return { value: value * 256 + this.bytes[at + 8], length: 9 };
  }

  /** The payload of a cell, gathered from its overflow pages when it spills. */
  private payload(at: number, size: number, index: boolean): Uint8Array {
    const u = this.usable;
    const maxLocal = index ? Math.floor(((u - 12) * 64) / 255) - 23 : u - 35;
    const minLocal = Math.floor(((u - 12) * 32) / 255) - 23;
    if (size <= maxLocal) return this.bytes.subarray(at, at + size);
    const k = minLocal + ((size - minLocal) % (u - 4));
    const local = k <= maxLocal ? k : minLocal;
    const out = new Uint8Array(size);
    out.set(this.bytes.subarray(at, at + local));
    let written = local;
    let next = this.view.getUint32(at + local);
    const seen = new Set<number>();
    while (written < size && next !== 0) {
      if (seen.has(next)) throw new SqliteError("A row's overflow pages loop; the file is damaged.");
      seen.add(next);
      const offset = this.pageOffset(next);
      const take = Math.min(u - 4, size - written);
      out.set(this.bytes.subarray(offset + 4, offset + 4 + take), written);
      written += take;
      next = this.view.getUint32(offset);
    }
    return out;
  }

  /** The values of a record, in the order they are stored. */
  record(payload: Uint8Array): SqliteValue[] {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const readVarint = (at: number) => {
      let value = 0;
      for (let index = 0; index < 8; index += 1) {
        const byte = payload[at + index];
        value = value * 128 + (byte & 0x7f);
        if (!(byte & 0x80)) return { value, length: index + 1 };
      }
      return { value: value * 256 + payload[at + 8], length: 9 };
    };
    const header = readVarint(0);
    const types: number[] = [];
    for (let at = header.length; at < header.value; ) {
      const type = readVarint(at);
      types.push(type.value);
      at += type.length;
    }
    const values: SqliteValue[] = [];
    let at = header.value;
    for (const type of types) {
      switch (type) {
        case 0:
          values.push(null);
          break;
        case 1:
          values.push(view.getInt8(at));
          at += 1;
          break;
        case 2:
          values.push(view.getInt16(at));
          at += 2;
          break;
        case 3:
          values.push((view.getInt8(at) << 16) | view.getUint16(at + 1));
          at += 3;
          break;
        case 4:
          values.push(view.getInt32(at));
          at += 4;
          break;
        case 5:
          values.push(view.getInt16(at) * 2 ** 32 + view.getUint32(at + 2));
          at += 6;
          break;
        case 6: {
          const big = view.getBigInt64(at);
          values.push(big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big);
          at += 8;
          break;
        }
        case 7:
          values.push(view.getFloat64(at));
          at += 8;
          break;
        case 8:
          values.push(0);
          break;
        case 9:
          values.push(1);
          break;
        default: {
          if (type < 12) {
            values.push(null);
            break;
          }
          const length = (type - (type % 2 === 0 ? 12 : 13)) / 2;
          const slice = payload.subarray(at, at + length);
          values.push(type % 2 === 0 ? slice.slice() : this.decoder.decode(slice));
          at += length;
        }
      }
    }
    return values;
  }

  /**
   * Every row of a B-tree, in key order: a table's as its rowid and
   * record, an index's (a WITHOUT ROWID table's) as its record alone.
   */
  *rows(rootPage: number): Generator<{ rowid: number | null; values: SqliteValue[] }> {
    const stack: number[] = [rootPage];
    const seen = new Set<number>();
    const pending: { rowid: number | null; values: SqliteValue[] }[] = [];
    // Pages are walked depth first with an explicit stack, children pushed
    // in reverse so they come off left to right.
    while (stack.length > 0) {
      const page = stack.pop()!;
      if (page < 0) {
        // An interior index cell's own record, placed between its children.
        yield pending[-page - 1];
        continue;
      }
      if (seen.has(page)) throw new SqliteError("The table's pages loop back on themselves; the file is damaged.");
      seen.add(page);
      const base = this.pageOffset(page);
      const header = base + (page === 1 ? 100 : 0);
      const type = this.bytes[header];
      const cells = this.view.getUint16(header + 3);
      const interior = type === 0x05 || type === 0x02;
      const pointers = header + (interior ? 12 : 8);
      if (type === 0x0d) {
        for (let index = 0; index < cells; index += 1) {
          let at = base + this.view.getUint16(pointers + index * 2);
          const size = this.varint(at);
          at += size.length;
          const rowid = this.varint(at);
          at += rowid.length;
          yield { rowid: rowid.value, values: this.record(this.payload(at, size.value, false)) };
        }
      } else if (type === 0x0a) {
        for (let index = 0; index < cells; index += 1) {
          let at = base + this.view.getUint16(pointers + index * 2);
          const size = this.varint(at);
          at += size.length;
          yield { rowid: null, values: this.record(this.payload(at, size.value, true)) };
        }
      } else if (type === 0x05 || type === 0x02) {
        const children: number[] = [];
        for (let index = 0; index < cells; index += 1) {
          const at = base + this.view.getUint16(pointers + index * 2);
          children.push(this.view.getUint32(at));
          if (type === 0x02) {
            const size = this.varint(at + 4);
            pending.push({ rowid: null, values: this.record(this.payload(at + 4 + size.length, size.value, true)) });
            children.push(-pending.length);
          }
        }
        children.push(this.view.getUint32(header + 8));
        for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
      } else {
        throw new SqliteError(`Page ${page} is not a B-tree page (its type byte is ${type}); the file is damaged.`);
      }
    }
  }

  /** The tables the schema lists, internal ones and virtual ones left out. */
  tables(): SqliteTable[] {
    const tables: SqliteTable[] = [];
    for (const { values } of this.rows(1)) {
      const [type, name, , rootPage, sql] = values;
      if (type !== "table" || typeof name !== "string" || typeof sql !== "string" || typeof rootPage !== "number" || rootPage === 0) continue;
      if (name.startsWith("sqlite_")) continue;
      const parsed = parseCreateTable(sql);
      tables.push({ name, columns: parsed.columns.map((column) => column.name), rootPage, withoutRowid: parsed.withoutRowid, sql });
    }
    return tables;
  }

  /** A table's rows as values in declared column order, the rowid filled in where a column stands for it. */
  *tableRows(table: SqliteTable): Generator<SqliteValue[]> {
    const parsed = parseCreateTable(table.sql);
    const stored = parsed.columns.filter((column) => column.stored);
    // A WITHOUT ROWID table's record holds its primary key first, then the rest in declared order.
    const order = parsed.withoutRowid && parsed.primaryKey.length > 0 ? [...parsed.primaryKey.map((key) => stored.find((column) => column.name.toLowerCase() === key.toLowerCase())).filter((column): column is (typeof stored)[number] => column !== undefined), ...stored.filter((column) => !parsed.primaryKey.some((key) => key.toLowerCase() === column.name.toLowerCase()))] : stored;
    const position = new Map(order.map((column, index) => [column, index]));
    for (const { rowid, values } of this.rows(table.rootPage)) {
      yield parsed.columns.map((column) => {
        if (column.rowidAlias) return rowid;
        const at = position.get(column);
        return at === undefined ? null : (values[at] ?? null);
      });
    }
  }
}

/** A value as a CSV cell: blobs as hex, exact integers, NULL as empty. */
export function cellOf(value: SqliteValue): string {
  if (value === null) return "";
  if (value instanceof Uint8Array) {
    let hex = "";
    for (const byte of value) hex += byte.toString(16).padStart(2, "0");
    return hex;
  }
  return String(value);
}

/** A value as JSON takes it: a big integer as a string, a blob as hex. */
export function jsonOf(value: SqliteValue): string | number | null {
  if (value === null || typeof value === "number" || typeof value === "string") return value;
  return cellOf(value);
}
