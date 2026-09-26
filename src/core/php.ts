/**
 * PHP built-ins the game uses, with PHP's behaviour, so ported code reads like the original. Dates and times are
 * always UTC (the upstream site runs in UTC).
 */
import { nowMs } from './time';
import { random } from './random';

// ---- Time ---------------------------------------------------------------------------------------------------------

/** Seconds since the epoch (PHP time()). */
export function time(): number {
    return Math.floor(nowMs() / 1000);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** PHP gmdate(): formats a Unix timestamp (default now) in UTC. Backslash escapes a character. */
export function gmdate(format: string, timestamp?: number | null): string {
    const d = new Date((timestamp ?? time()) * 1000);
    let out = '';
    for (let i = 0; i < format.length; i++) {
        const c = format[i];
        const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate(), h = d.getUTCHours(), w = d.getUTCDay();
        switch (c) {
            case '\\': out += format[++i] ?? ''; break;
            case 'Y': out += y; break;
            case 'y': out += pad(y % 100); break;
            case 'm': out += pad(m + 1); break;
            case 'n': out += m + 1; break;
            case 'd': out += pad(day); break;
            case 'j': out += day; break;
            case 'H': out += pad(h); break;
            case 'G': out += h; break;
            case 'h': out += pad(h % 12 || 12); break;
            case 'g': out += h % 12 || 12; break;
            case 'i': out += pad(d.getUTCMinutes()); break;
            case 's': out += pad(d.getUTCSeconds()); break;
            case 'A': out += h < 12 ? 'AM' : 'PM'; break;
            case 'a': out += h < 12 ? 'am' : 'pm'; break;
            case 'N': out += w || 7; break;
            case 'w': out += w; break;
            case 'D': out += DAYS[w].slice(0, 3); break;
            case 'l': out += DAYS[w]; break;
            case 'M': out += MONTHS[m].slice(0, 3); break;
            case 'F': out += MONTHS[m]; break;
            case 'U': out += Math.floor(d.getTime() / 1000); break;
            case 't': out += new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); break;
            case 'z': out += Math.floor((Date.UTC(y, m, day) - Date.UTC(y, 0, 1)) / 86400000); break;
            case 'S': out += ordinalSuffix(day); break;
            case 'L': out += (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 1 : 0; break;
            default: out += c;
        }
    }
    return out;
}

/** PHP date(): the same as gmdate here, as the game runs in UTC. */
export const date = gmdate;

function ordinalSuffix(n: number): string {
    if (n % 100 >= 11 && n % 100 <= 13) return 'th';
    return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

/**
 * PHP strtotime(), for the forms the game uses: an optional absolute date or date-time ('2026-01-31',
 * '2026-01-31 12:00:00', 'today', 'tomorrow', 'yesterday', 'now', 'midnight'), an optional 'UTC', a time of day ('00:00'), and
 * relative parts ('+3 days', '-2 weeks', '+1 day', '1 hour'). Everything is UTC. Returns false if it can't be read.
 */
export function strtotime(text: string, base?: number): number | false {
    let rest = ` ${String(text).trim()} `;
    let ms = (base ?? time()) * 1000;
    const take = (re: RegExp): RegExpMatchArray | null => {
        const m = rest.match(re);
        if (m) rest = rest.replace(re, ' ');
        return m;
    };
    let m = take(/\s(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s/);
    if (m) {
        ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
    }
    const startOfDay = (t: number) => Math.floor(t / 86400000) * 86400000;
    if (take(/\s(today|midnight)\s/i)) ms = startOfDay(ms);
    if (take(/\stomorrow\s/i)) ms = startOfDay(ms) + 86400000;
    if (take(/\syesterday\s/i)) ms = startOfDay(ms) - 86400000;
    take(/\snow\s/i);
    take(/\s(UTC|GMT|Z)\s/i);
    m = take(/\s(\d{1,2}):(\d{2})(?::(\d{2}))?\s/);
    if (m) ms = startOfDay(ms) + ((+m[1] * 60 + +m[2]) * 60 + +(m[3] ?? 0)) * 1000;
    const units: Record<string, number> = { sec: 1, second: 1, min: 60, minute: 60, hour: 3600, day: 86400, week: 604800, fortnight: 1209600 };
    while ((m = take(/\s([+-]?)\s*(\d+)\s*(sec|second|min|minute|hour|day|week|fortnight|month|year)s?\s/i))) {
        const n = (m[1] === '-' ? -1 : 1) * +m[2];
        const unit = m[3].toLowerCase();
        if (unit === 'month' || unit === 'year') {
            const d = new Date(ms);
            d.setUTCMonth(d.getUTCMonth() + (unit === 'year' ? 12 * n : n));
            ms = d.getTime();
        } else {
            ms += n * units[unit] * 1000;
        }
    }
    if (rest.trim() !== '') return false;
    return Math.floor(ms / 1000);
}

/** strtotime() for code that knows its input is good (throws otherwise, rather than giving false). */
export function strtotimeOrThrow(text: string, base?: number): number {
    const t = strtotime(text, base);
    if (t === false) throw new Error(`strtotime can't read "${text}"`);
    return t;
}

/** Today (real), 'YYYY-MM-DD' (gmdate('Y-m-d')). The game's own date is Clock.today() (src/game/Clock.ts). */
export function today(): string {
    return gmdate('Y-m-d');
}

/** Now (real), 'YYYY-MM-DD HH:MM:SS' (gmdate('Y-m-d H:i:s')). The game's own time is Clock.now(). */
export function nowDateTime(): string {
    return gmdate('Y-m-d H:i:s');
}

/** A 'YYYY-MM-DD' date moved by some days. */
export function addDays(dateString: string, days: number): string {
    return gmdate('Y-m-d', strtotimeOrThrow(dateString.slice(0, 10) + ' UTC') + days * 86400);
}

// ---- Numbers ------------------------------------------------------------------------------------------------------

/** PHP round(): half away from zero, to some decimal places. */
export function round(value: number, precision = 0): number {
    const factor = 10 ** precision;
    // PHP pre-rounds to 15 significant digits, so 1.005 * 100 (100.49999...) rounds up as it would on paper.
    const n = Number((Math.abs(value) * factor).toPrecision(15));
    return (Math.sign(value) * Math.round(n)) / factor || 0;
}

/** PHP intdiv(): integer division, truncated toward zero. */
export function intdiv(a: number, b: number): number {
    if (b === 0) throw new Error('Division by zero');
    return Math.trunc(a / b);
}

/** PHP number_format(). */
export function number_format(num: number | string, decimals = 0, decimalPoint = '.', thousands = ','): string {
    const n = round(Number(num), decimals);
    const [whole, fraction] = Math.abs(n).toFixed(decimals).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return (n < 0 && Number(n.toFixed(decimals)) !== 0 ? '-' : '') + grouped + (decimals > 0 ? decimalPoint + fraction : '');
}

/** PHP's (int) cast of a value (strings read as far as they're numeric; null/false 0; true 1). */
export function int(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string') {
        const m = value.trim().match(/^[+-]?\d+(\.\d+)?(e[+-]?\d+)?/i);
        return m ? Math.trunc(Number(m[0])) : 0;
    }
    return 0;
}

/** PHP's (float) cast. */
export function float(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string') {
        const m = value.trim().match(/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
        return m ? Number(m[0]) : 0;
    }
    return 0;
}

/** PHP's (string) cast (null '', false '', true '1', numbers as PHP prints them). */
export function str(value: unknown): string {
    if (value === null || value === undefined || value === false) return '';
    if (value === true) return '1';
    return String(value);
}

/** PHP truthiness (empty(): '', '0', 0, null, false, [] and {} are empty). */
export function empty(value: unknown): boolean {
    if (value === null || value === undefined || value === false || value === 0 || value === '' || value === '0') return true;
    if (Array.isArray(value)) return value.length === 0;
    if (value instanceof Map || value instanceof Set) return value.size === 0;
    if (typeof value === 'object') return Object.keys(value as object).length === 0;
    return Number.isNaN(value);
}

/** PHP ctype_digit(): a non-empty string of 0-9 only. */
export function ctype_digit(value: unknown): boolean {
    return typeof value === 'string' && /^\d+$/.test(value);
}

/** PHP is_numeric(). */
export function is_numeric(value: unknown): boolean {
    if (typeof value === 'number') return Number.isFinite(value);
    return typeof value === 'string' && /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(value);
}

// ---- Randomness ---------------------------------------------------------------------------------------------------

/** PHP random_int(): an integer from min to max, inclusive. */
export function random_int(min: number, max: number): number {
    if (min > max) throw new Error('random_int: min is greater than max');
    return min + Math.floor(random() * (max - min + 1));
}

export const mt_rand = random_int;

/** PHP array_rand() for one pick: a random index (or key, for an object or Map). */
export function array_rand<K>(list: unknown[] | Record<string, unknown> | Map<K, unknown>): any {
    const keys = Array.isArray(list) ? list.map((_, i) => i) : list instanceof Map ? [...list.keys()] : Object.keys(list);
    if (keys.length === 0) throw new Error('array_rand: empty array');
    return keys[Math.floor(random() * keys.length)];
}

/** A random element of a list (PHP $list[array_rand($list)]). */
export function pick<T>(list: T[]): T {
    return list[array_rand(list)];
}

/** PHP shuffle(), in place; also returns the list. */
export function shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

/** PHP bin2hex(random_bytes(n)): 2n random hex digits. */
export function randomHex(bytes: number): string {
    let out = '';
    for (let i = 0; i < bytes; i++) out += Math.floor(random() * 256).toString(16).padStart(2, '0');
    return out;
}

// ---- Strings ------------------------------------------------------------------------------------------------------

export function ucfirst(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

export function lcfirst(s: string): string {
    return s.charAt(0).toLowerCase() + s.slice(1);
}

export function ucwords(s: string): string {
    return s.replace(/(^|[\s\t\r\n\f\v])(\S)/g, (_, space, c) => space + c.toUpperCase());
}

/** PHP mb_strlen(): length in code points. */
export function mb_strlen(s: string): number {
    return [...s].length;
}

/** PHP mb_substr() (code points). */
export function mb_substr(s: string, start: number, length?: number): string {
    const chars = [...s];
    const from = start < 0 ? Math.max(0, chars.length + start) : start;
    const to = length === undefined ? chars.length : length < 0 ? chars.length + length : from + length;
    return chars.slice(from, to).join('');
}

/** PHP trim() (whitespace and NUL). */
export function trim(s: unknown): string {
    return str(s).replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
}

/** PHP sha1(), hex. */
export function sha1(message: string): string {
    const bytes = new TextEncoder().encode(message);
    const words: number[] = [];
    for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    const bitLength = bytes.length * 8;
    words[bitLength >> 5] |= 0x80 << (24 - (bitLength % 32));
    words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;
    let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const w = new Array<number>(80);
    const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
    for (let i = 0; i < words.length; i += 16) {
        let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
        for (let t = 0; t < 80; t++) {
            w[t] = t < 16 ? words[i + t] | 0 : rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
            const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
            const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
            const temp = (rotl(a, 5) + f + e + k + w[t]) | 0;
            [e, d, c, b, a] = [d, c, rotl(b, 30), a, temp];
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

// ---- Arrays -------------------------------------------------------------------------------------------------------

/** PHP array_column(): a column of each row, or (with indexKey) a Map of indexKey => that column (or the row). */
export function array_column<T extends Record<string, any>>(rows: T[], column: string | null): any[] {
    return rows.map((row) => (column === null ? row : row[column]));
}

/** PHP array_sum(). */
export function array_sum(values: Iterable<unknown>): number {
    let sum = 0;
    for (const v of values) sum += float(v);
    return sum;
}

/** PHP array_unique() for scalars, keeping the first of each (as a list). */
export function array_unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

/** PHP array_count_values(), as a Map in order of first appearance. */
export function array_count_values<T>(values: T[]): Map<T, number> {
    const counts = new Map<T, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return counts;
}

/** PHP array_chunk() of a list. */
export function array_chunk<T>(values: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
    return out;
}

/** PHP array_fill(0, n, value). */
export function array_fill<T>(count: number, value: T): T[] {
    return Array.from({ length: count }, () => value);
}

/** PHP range(). */
export function range(start: number, end: number, step = 1): number[] {
    const out: number[] = [];
    if (start <= end) for (let i = start; i <= end; i += step) out.push(i);
    else for (let i = start; i >= end; i -= step) out.push(i);
    return out;
}

/** PHP's <=> for sort callbacks: numbers numerically, strings by strcmp. */
export function spaceship(a: any, b: any): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1;
    if (is_numeric(a) && is_numeric(b)) return Number(a) < Number(b) ? -1 : Number(a) > Number(b) ? 1 : 0;
    const x = String(a), y = String(b);
    return x < y ? -1 : x > y ? 1 : 0;
}

/** PHP strcasecmp()-style comparison, for sorting names the way the database's collation does. */
export function strcasecmp(a: string, b: string): number {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
}

/** PHP http_build_query() for a flat object. */
export function http_build_query(params: Record<string, unknown>): string {
    return Object.entries(params)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(str(v)))
        .join('&');
}

/**
 * PHP json_encode() with its default flags: slashes escaped (\/) and non-ASCII as \uXXXX. Maps and Sets encode as
 * objects and lists.
 */
export function json_encode(value: unknown): string {
    return JSON.stringify(value, (_, v) => (v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v))
        .replace(/\//g, '\\/')
        .replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
