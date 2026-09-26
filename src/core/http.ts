/**
 * Requests and responses between the page (src/shell) and the game in the worker. The page turns link clicks and form
 * submissions into requests; the game answers each with a page of HTML, a redirect, JSON or a file to download, as
 * upstream's PHP answers the browser.
 */

/** A form field or query value as PHP would give it: a string, or a nested array for names like a[] and a[b]. */
export type Input = string | InputArray;
export interface InputArray {
    [key: string]: Input;
}

/** A file posted with a form (the page reads it as text). */
export interface PostedFile {
    name: string;
    type: string;
    text: string;
}

export interface RequestInit {
    method: 'GET' | 'POST';
    /** The path and query, e.g. '/game/assets?q=Bo'. */
    url: string;
    /** Form fields in the order the form sent them, [name, value] (PHP's names: a[] and a[b] make arrays). */
    form?: [string, string][];
    files?: Record<string, PostedFile>;
}

export class Request {
    readonly method: 'GET' | 'POST';
    /** The path without a trailing slash (upstream: rtrim(parse_url(REQUEST_URI, PATH), '/')). */
    readonly path: string;
    readonly uri: string;
    /** $_GET */
    readonly query: InputArray;
    /** $_POST */
    readonly post: InputArray;
    /** $_FILES */
    readonly files: Record<string, PostedFile>;

    constructor(init: RequestInit) {
        this.method = init.method;
        this.uri = init.url;
        const [path, search = ''] = init.url.split('?', 2);
        this.path = path.replace(/\/+$/, '');
        this.query = parseInput([...new URLSearchParams(search)]);
        this.post = parseInput(init.form ?? []);
        this.files = init.files ?? {};
    }

    get isPost(): boolean {
        return this.method === 'POST';
    }
}

/** Builds PHP's nested arrays from field names like name, list[], map[key] and map[key][]. */
export function parseInput(pairs: [string, string][]): InputArray {
    const out: InputArray = {};
    for (const [name, value] of pairs) {
        const m = name.match(/^([^[]+)((?:\[[^\]]*\])*)$/);
        if (!m) {
            out[name] = value;
            continue;
        }
        const keys = [m[1], ...[...m[2].matchAll(/\[([^\]]*)\]/g)].map((k) => k[1])];
        let target: InputArray = out;
        keys.forEach((key, i) => {
            const last = i === keys.length - 1;
            if (key === '') key = String(Object.keys(target).filter((k) => /^\d+$/.test(k)).length);
            if (last) {
                target[key] = value;
            } else {
                if (typeof target[key] !== 'object') target[key] = {};
                target = target[key] as InputArray;
            }
        });
    }
    return out;
}

/** A field as a string ((string)($_POST['x'] ?? '')): '' when it's missing or an array. */
export function field(input: InputArray, name: string, fallback = ''): string {
    const v = input[name];
    return typeof v === 'string' ? v : fallback;
}

/** A field that's an array (PHP a[] or a[key]), as an object; {} when missing. */
export function fieldArray(input: InputArray, name: string): InputArray {
    const v = input[name];
    return typeof v === 'object' && v !== null ? v : {};
}

/** A field that's a list (a[]), as a list of strings. */
export function fieldList(input: InputArray, name: string): string[] {
    return Object.values(fieldArray(input, name)).filter((v): v is string => typeof v === 'string');
}

export type Response =
    | { kind: 'html'; status: number; html: string; title: string }
    | { kind: 'redirect'; location: string }
    | { kind: 'json'; status: number; body: unknown }
    | { kind: 'download'; filename: string; type: string; data: string | Uint8Array };

/** Thrown to end a request with a redirect (upstream's Game\Redirect). */
export class Redirect extends Error {
    constructor(public readonly location: string) {
        super(`Redirect to ${location}`);
    }
}

/** Thrown to end a request with a response other than a page (JSON, a download). */
export class Respond extends Error {
    constructor(public readonly response: Response) {
        super('Response');
    }
}
