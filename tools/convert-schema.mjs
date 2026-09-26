#!/usr/bin/env node
// Converts the upstream game's MariaDB schema and seed rows (tools/ref/*.mysql.sql, dumped from a database that
// jcw-website's bin/migrate.php built: see tools/refresh-ref.sh) into SQLite: src/db/schema.sql and src/db/seed.sql.
//
// Rules: integers are INTEGER, decimals REAL, dates and times TEXT ('YYYY-MM-DD[ HH:MM:SS[.ffffff]]', UTC), strings
// TEXT COLLATE NOCASE (the upstream collation, utf8mb4_unicode_ci, is case-insensitive), enums TEXT with a CHECK.
// An AUTO_INCREMENT key is INTEGER PRIMARY KEY AUTOINCREMENT, so ids are never reused (as in MariaDB).
// current_timestamp() defaults call UTC_TIMESTAMP() (registered in src/db/functions.ts, so it follows the game clock).
// Triggers aren't converted: they're hand-written in src/db/triggers.sql.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dump = readFileSync(join(root, 'tools/ref/schema.mysql.sql'), 'utf8');
const seed = readFileSync(join(root, 'tools/ref/seed.mysql.sql'), 'utf8');

const tables = [];
// Each table's columns and their upstream types, and the foreign keys (for Board, Saves: upstream reads these from
// information_schema).
const meta = { columns: {}, foreignKeys: [] };
for (const match of dump.matchAll(/CREATE TABLE `(game_\w+)` \(\n([\s\S]*?)\n\)[^;]*;/g)) {
    const lines = match[2].split('\n').map((l) => l.trim().replace(/,$/, ''));
    tables.push(convertTable(match[1], lines));
    meta.columns[match[1]] = {};
    for (const line of lines) {
        let m;
        if ((m = line.match(/^`(\w+)` (\w+)/))) meta.columns[match[1]][m[1]] = m[2];
        if ((m = line.match(/FOREIGN KEY \(`(\w+)`\) REFERENCES `(\w+)` \(`(\w+)`\)/))) {
            meta.foreignKeys.push({ table: match[1], column: m[1], references: m[2], referencedColumn: m[3] });
        }
    }
}

function convertTable(name, lines) {
    const columns = [];
    const constraints = [];
    const indexes = [];
    let autoIncrement = null;
    let primary = null;
    for (const line of lines) {
        let m;
        if ((m = line.match(/^`(\w+)` (.*)$/))) {
            columns.push(m);
            if (/AUTO_INCREMENT/.test(m[2])) autoIncrement = m[1];
        } else if ((m = line.match(/^PRIMARY KEY \((.*)\)$/))) {
            primary = m[1].replace(/`/g, '');
        } else if ((m = line.match(/^UNIQUE KEY `(\w+)` \((.*)\)$/))) {
            constraints.push(`UNIQUE (${cols(m[2])})`);
        } else if ((m = line.match(/^KEY `(\w+)` \((.*)\)$/))) {
            indexes.push(`CREATE INDEX ${name}__${m[1]} ON ${name} (${cols(m[2])});`);
        } else if ((m = line.match(/^CONSTRAINT `\w+` FOREIGN KEY \((.*?)\) REFERENCES `(\w+)` \((.*?)\)(.*)$/))) {
            constraints.push(`FOREIGN KEY (${cols(m[1])}) REFERENCES ${m[2]} (${cols(m[3])})${m[4].replace(/\s+/g, ' ').trimEnd()}`);
        } else {
            throw new Error(`${name}: can't convert "${line}"`);
        }
    }
    const defs = columns.map(([, column, rest]) => {
        if (column === autoIncrement) {
            if (primary !== column) throw new Error(`${name}: AUTO_INCREMENT ${column} isn't the primary key`);
            return `${column} INTEGER PRIMARY KEY AUTOINCREMENT`;
        }
        return `${column} ${convertType(rest)}`;
    });
    if (primary && primary !== autoIncrement) defs.push(`PRIMARY KEY (${primary.split(',').join(', ')})`);
    return [`CREATE TABLE ${name} (\n    ${[...defs, ...constraints].join(',\n    ')}\n);`, ...indexes].join('\n');
}

function cols(list) {
    return list.replace(/`/g, '').replace(/\(\d+\)/g, '').split(',').join(', ');
}

function convertType(rest) {
    let m = rest.match(/^(\w+)(?:\(([^)]*)\))?( unsigned)?(.*)$/);
    if (!m) throw new Error(`can't convert type "${rest}"`);
    const [, type, args, , tail] = m;
    let sql;
    switch (type) {
        case 'int': case 'bigint': case 'tinyint': case 'smallint': case 'mediumint':
            sql = 'INTEGER'; break;
        case 'decimal': case 'double': case 'float':
            sql = 'REAL'; break;
        case 'varchar': case 'char': case 'text': case 'mediumtext': case 'longtext':
            sql = 'TEXT COLLATE NOCASE'; break;
        case 'date': case 'datetime': case 'timestamp':
            sql = 'TEXT'; break;
        case 'longblob': case 'blob': case 'mediumblob':
            sql = 'BLOB'; break;
        case 'enum':
            sql = `TEXT CHECK (%COL% IN (${args}))`; break;
        default:
            throw new Error(`unknown type ${type}`);
    }
    let rules = tail.trim()
        .replace(/DEFAULT current_timestamp\(6\)/, 'DEFAULT (UTC_TIMESTAMP(6))')
        .replace(/DEFAULT current_timestamp\(\)/, 'DEFAULT (UTC_TIMESTAMP())')
        .replace(/ON UPDATE current_timestamp\(\)/, '')
        .replace(/DEFAULT NULL/, '')
        .replace(/COLLATE \w+/, '')
        .replace(/\s+/g, ' ')
        .trim();
    return (sql + (rules ? ' ' + rules : '')).replace(/\s+/g, ' ');
}

// %COL% in a CHECK is the column's own name.
const schema = tables.map((t) => t.replace(/^(\s*)(\w+) (TEXT CHECK \()%COL%/gm, '$1$2 $3$2')).join('\n\n');

// The site's accounts, which the game refers to (players, admins, who did what). Not converted: the game only needs
// a name and the two roles. In the browser there's one account, the person playing (see src/core/Auth.ts).
const users = `CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT COLLATE NOCASE NOT NULL UNIQUE,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_player INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (UTC_TIMESTAMP())
);`;

const header = '-- Generated by tools/convert-schema.mjs from the upstream schema. Do not edit: rerun `npm run schema`.\n\n';
writeFileSync(join(root, 'src/db/schema.sql'), header + users + '\n\n' + schema + '\n');

// Seed rows: MariaDB escapes quotes with a backslash; SQLite doubles them.
const inserts = seed.split('\n').filter((l) => l.startsWith('INSERT INTO')).map((l) =>
    l.replace(/`/g, '').replace(/\\'/g, "''").replace(/\\\\/g, '\\'));
writeFileSync(join(root, 'src/db/seed.sql'), header + inserts.join('\n') + '\n');
writeFileSync(join(root, 'src/db/meta.ts'), `// Generated by tools/convert-schema.mjs from the upstream schema. Do not edit: rerun \`npm run schema\`.
// Upstream code reads these from information_schema.

export interface ForeignKey {
    table: string;
    column: string;
    references: string;
    referencedColumn: string;
}

/** Each game table's columns, with their upstream (MariaDB) types: int, varchar, date, datetime, decimal, enum... */
export const COLUMNS: Record<string, Record<string, string>> = ${JSON.stringify(meta.columns, null, 4)};

export const FOREIGN_KEYS: ForeignKey[] = ${JSON.stringify(meta.foreignKeys, null, 4)};

/** A table's DATE, DATETIME and TIMESTAMP columns, in order. */
export function dateColumns(table: string): string[] {
    return Object.entries(COLUMNS[table] ?? {}).filter(([, type]) => ['date', 'datetime', 'timestamp'].includes(type)).map(([name]) => name);
}
`);
console.log(`${tables.length} tables, ${inserts.length} seed rows`);
