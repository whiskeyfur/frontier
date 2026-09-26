/**
 * Page tests: upstream's AppTest request(), get() and post(), which run one request through the game (App.run) as a
 * user and return what it answered.
 */
import { expect } from 'vitest';
import type { User } from '../src/core/Auth';
import { Request } from '../src/core/http';
import { http_build_query } from '../src/core/php';
import { App } from '../src/game/App';
import { Session } from '../src/core/Session';
import { login } from './TestCase';

export type Fields = Record<string, unknown>;

/** Flattens PHP-style nested fields ({a: {b: 1}, c: [1, 2]}) to the names a form sends: a[b], c[0], c[1]. */
export function formPairs(fields: Fields, prefix = ''): [string, string][] {
    const pairs: [string, string][] = [];
    for (const [key, value] of Object.entries(fields)) {
        const name = prefix ? `${prefix}[${key}]` : key;
        if (value === null || value === undefined) continue;
        if (typeof value === 'object' && !(value instanceof Uint8Array)) {
            pairs.push(...formPairs(value as Fields, name));
        } else {
            pairs.push([name, value === true ? '1' : value === false ? '' : String(value)]);
        }
    }
    return pairs;
}

/**
 * Runs one request through the game. Returns [status, redirect location or null, body] (for JSON, the body is the
 * JSON text; for a download, its contents).
 */
export function request(method: 'GET' | 'POST', path: string, post: Fields = {}, as: User | null = null, get: Fields = {}): [number, string | null, string] {
    if (as !== null) {
        login(as);
    }
    const query = http_build_query(get);
    const response = new App(new Request({ method, url: path + (query ? '?' + query : ''), form: formPairs(post) })).run();
    switch (response.kind) {
        case 'redirect':
            return [303, response.location, ''];
        case 'html':
            return [response.status, null, response.html];
        case 'json':
            return [response.status, null, JSON.stringify(response.body)];
        case 'download':
            return [200, null, typeof response.data === 'string' ? response.data : new TextDecoder().decode(response.data)];
    }
}

/** A GET that must answer 200 with a page; returns the page. */
export function get(path: string, as: User, query: Fields = {}): string {
    const [status, location, body] = request('GET', path, {}, as, query);
    expect(location, `GET ${path} redirected to ${location}.`).toBeNull();
    expect(status, `GET ${path}`).toBe(200);
    return body;
}

/** A POST that must redirect (as upstream's post()); returns where to. */
export function post(path: string, fields: Fields, as: User): string {
    const [, location, body] = request('POST', path, fields, as);
    expect(location, `POST ${path} didn't redirect: ` + body.slice(0, 3000).replace(/<[^>]*>/g, '')).not.toBeNull();
    return location!;
}

/** The flash message waiting for the next page (upstream's $_SESSION['flash']). */
export function flash(): unknown {
    return Session.data.flash ?? null;
}

/** A POST that must answer with a page (not a redirect); returns the page. */
export function postPage(path: string, fields: Fields, as: User): string {
    const [, location, body] = request('POST', path, fields, as);
    expect(location, `POST ${path} redirected to ${location}.`).toBeNull();
    return body;
}

/** Blade's e(), to look for escaped text in a page. */
export { e } from '../src/core/html';
