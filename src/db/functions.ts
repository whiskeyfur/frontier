/**
 * MariaDB functions the game's SQL uses, registered on each SQLite connection, so queries port with few changes.
 * They follow MariaDB: NULL in, NULL out (GREATEST, LEAST, CONCAT, DATEDIFF...). Dates are 'YYYY-MM-DD' text and
 * times 'YYYY-MM-DD HH:MM:SS' text, in UTC, from the real clock (src/core/time.ts, which tests can stop). The game's own
 * time (src/game/Clock.ts) goes into queries as literals (Clock.sqlToday(), Clock.sqlNow()), as upstream's does.
 *
 * Not the same as MariaDB, so rewrite these when porting (see PORTING.md):
 *   x + INTERVAL n DAY  → ADDDATE(x, n)        x - INTERVAL n DAY → SUBDATE(x, n)
 *   DATE_ADD(x, INTERVAL n DAY) → ADDDATE(x, n)
 *   TIMESTAMPDIFF(HOUR, a, b) → TIMESTAMPDIFF('HOUR', a, b)
 *   CAST(x AS SIGNED) → CAST(x AS INTEGER)
 */
import type { Database } from 'sql.js';
import { nowMs } from '../core/time';
import { random } from '../core/random';

type Value = number | string | Uint8Array | null;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function formatDate(ms: number): string {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function formatDateTime(ms: number, fraction = 0): string {
    const d = new Date(ms);
    const base = `${formatDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    if (!fraction) return base;
    // The clock only has milliseconds; the rest of the microseconds come from a counter, so times taken in one
    // millisecond still sort in the order they were taken (as MariaDB's DATETIME(6) would).
    micro = ms === lastMs ? micro + 1 : 0;
    lastMs = ms;
    return base + '.' + (pad(d.getUTCMilliseconds(), 3) + pad(Math.min(micro, 999), 3)).slice(0, fraction);
}
let lastMs = 0;
let micro = 0;

/** Parses a date or date-time text (UTC) to ms, or null. */
export function parseDateTime(value: Value): number | null {
    if (value === null || value instanceof Uint8Array) return null;
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[7] ? +m[7].slice(0, 3).padEnd(3, '0') : 0);
}

/** Moves a date or date-time by whole days, keeping its form (a date stays a date). */
export function shiftDays(value: Value, days: number): string | null {
    const ms = parseDateTime(value);
    if (ms === null) return null;
    const text = String(value);
    const shifted = ms + Math.round(days) * 86400000;
    if (text.length <= 10) return formatDate(shifted);
    // Keep any fraction of a second as it was.
    const fraction = text.match(/\.(\d+)$/)?.[1];
    return formatDateTime(shifted) + (fraction ? '.' + fraction : '');
}

function compare(a: Value, b: Value): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const x = String(a), y = String(b);
    // Numeric strings compare as numbers (as MariaDB does when one side is a number).
    if ((typeof a === 'number' || typeof b === 'number') && x.trim() !== '' && y.trim() !== '' && !isNaN(+x) && !isNaN(+y)) return +x - +y;
    return x < y ? -1 : x > y ? 1 : 0;
}

export function registerFunctions(db: Database, variable: (name: string) => Value = () => null): void {
    // sql.js registers a function with as many arguments as its .length; -1 lets it take any number (for optional
    // and variadic arguments).
    const fn = (name: string, f: (...args: any[]) => Value, variadic = false) => {
        if (variadic) Object.defineProperty(f, 'length', { value: -1 });
        db.create_function(name, f as any);
    };
    fn('UTC_DATE', () => formatDate(nowMs()));
    fn('CURDATE', () => formatDate(nowMs()));
    fn('UTC_TIMESTAMP', (fraction?: number) => formatDateTime(nowMs(), fraction ?? 0), true);
    fn('NOW', (fraction?: number) => formatDateTime(nowMs(), fraction ?? 0), true);
    fn('RAND', () => random());
    // A user variable (MariaDB's @name: see Db.setVariable), or NULL.
    fn('VARIABLE', (name: Value) => variable(String(name)));
    fn('IF', (condition: Value, a: Value, b: Value) => (condition !== null && condition !== 0 && condition !== '0' && condition !== '' ? a : b));
    fn('FLOOR', (x: Value) => (x === null ? null : Math.floor(Number(x))));
    fn('CEIL', (x: Value) => (x === null ? null : Math.ceil(Number(x))));
    fn('CEILING', (x: Value) => (x === null ? null : Math.ceil(Number(x))));
    fn('POW', (x: Value, y: Value) => (x === null || y === null ? null : Number(x) ** Number(y)));
    fn('POWER', (x: Value, y: Value) => (x === null || y === null ? null : Number(x) ** Number(y)));
    fn('SQRT', (x: Value) => (x === null ? null : Math.sqrt(Number(x))));
    fn('CHAR_LENGTH', (x: Value) => (x === null ? null : [...String(x)].length));
    fn('DATEDIFF', (a: Value, b: Value) => {
        const x = parseDateTime(a), y = parseDateTime(b);
        if (x === null || y === null) return null;
        return Math.round((Math.floor(x / 86400000) * 86400000 - Math.floor(y / 86400000) * 86400000) / 86400000);
    });
    fn('ADDDATE', (d: Value, days: Value) => (days === null ? null : shiftDays(d, Number(days))));
    fn('SUBDATE', (d: Value, days: Value) => (days === null ? null : shiftDays(d, -Number(days))));
    fn('TIMESTAMPDIFF', (unit: Value, a: Value, b: Value) => {
        const x = parseDateTime(a), y = parseDateTime(b);
        if (x === null || y === null) return null;
        const seconds = (y - x) / 1000;
        const per: Record<string, number> = { SECOND: 1, MINUTE: 60, HOUR: 3600, DAY: 86400, WEEK: 604800 };
        const size = per[String(unit).toUpperCase()];
        if (!size) throw new Error(`TIMESTAMPDIFF: unit ${unit} isn't supported`);
        return Math.trunc(seconds / size);
    });
    // Variadic: NULL if any argument is NULL, as in MariaDB.
    const greatest = (...args: Value[]) => (args.some((a) => a === null) ? null : args.reduce((m, a) => (compare(a, m) > 0 ? a : m)));
    const least = (...args: Value[]) => (args.some((a) => a === null) ? null : args.reduce((m, a) => (compare(a, m) < 0 ? a : m)));
    fn('GREATEST', greatest, true);
    fn('LEAST', least, true);
    fn('CONCAT', (...args: Value[]) => (args.some((a) => a === null) ? null : args.map(String).join('')), true);
}
