/**
 * The page. The game runs in a worker (src/worker/worker.ts) and answers requests with pages of HTML; this turns the
 * page's links and forms into those requests and shows the answers, as a browser does with a website.
 *
 * Addresses are kept in the fragment (#/game/home), so the file works from the disk (file://) with no server, and the
 * browser's back and forward buttons work. Links the game writes as /game/... are rewritten to #/game/....
 */
import 'bootstrap/dist/css/bootstrap.min.css';
import * as bootstrap from 'bootstrap';
import tablesJs from './site/tables.js?raw';
import selectGroupsJs from './site/select-groups.js?raw';
import GameWorker from '../worker/worker.ts?worker&inline';
import type { RequestInit, Response } from '../core/http';
import type { Call, CallMessage, NoticeMessage, ReplyMessage, Result } from '../worker/protocol';
import { installLayoutScripts } from './layout-scripts';

// Page scripts (and upstream's) use the global, as they did with bootstrap.bundle.min.js.
(window as any).bootstrap = bootstrap;

const HOME = '/game/home';

// ---- The worker -------------------------------------------------------------------------------------------------

const worker: Worker = new GameWorker();
let nextId = 1;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

worker.onmessage = (event: MessageEvent<ReplyMessage | NoticeMessage>) => {
    const message = event.data;
    if (message.id === undefined) {
        showStorageNotice(message);
        return;
    }
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (!call) return;
    if (message.ok) call.resolve(message.result);
    else call.reject(new Error(message.error));
};
worker.onerror = (event) => showError(`The game stopped: ${event.message}`);

function send<C extends Call>(call: C): Promise<Result<C>> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const message = { id, ...call } as CallMessage;
        worker.postMessage(message, call.kind === 'import' ? [call.bytes.buffer] : []);
    });
}

/** Asks the game for a URL and returns its answer (for scripts that fetched JSON from the server upstream). */
export function request(init: RequestInit): Promise<Response> {
    return send({ kind: 'request', init });
}

// ---- Addresses ----------------------------------------------------------------------------------------------------

/** The game path the page is at ('/game/home?x=1'), from the fragment. */
function currentUrl(): string {
    const hash = decodeURI(location.hash.slice(1));
    return hash.startsWith('/') ? hash : HOME;
}

/** Game addresses (/game/..., /user, /) as fragment links, so they work from the disk and in a new tab. */
function toHref(url: string): string {
    return '#' + url;
}

function isGameUrl(url: string): boolean {
    return url.startsWith('/') && !url.startsWith('//');
}

// ---- Navigation ---------------------------------------------------------------------------------------------------

let busy = 0;

/** Loads a URL: GET, or POST with a form's fields. push: add it to the history (a new page), else replace. */
async function navigate(init: RequestInit, push: boolean, redirects = 0): Promise<void> {
    busy++;
    document.documentElement.classList.add('frontier-busy');
    try {
        // A #fragment after the path is the place in the page, not part of the request.
        const response = await request({ ...init, url: init.url.split('#')[0] });
        switch (response.kind) {
            case 'redirect':
                if (redirects > 10) throw new Error('Too many redirects');
                // A redirect after a POST is a new page (as the browser's history has it); one after a GET replaces it.
                await navigate({ method: 'GET', url: response.location }, push || init.method === 'POST', redirects + 1);
                return;
            case 'html':
                setUrl(init.url, push);
                render(response.html, response.title);
                return;
            case 'json':
                setUrl(init.url, push);
                render(`<main class="container"><pre>${escapeHtml(JSON.stringify(response.body, null, 2))}</pre></main>`, 'JSON');
                return;
            case 'download':
                download(response.filename, response.type, response.data);
                return;
        }
    } catch (e) {
        showError((e as Error).message);
    } finally {
        busy--;
        if (!busy) document.documentElement.classList.remove('frontier-busy');
    }
}

function setUrl(url: string, push: boolean): void {
    const href = toHref(url);
    if (location.hash === href) return;
    if (push) history.pushState(null, '', href);
    else history.replaceState(null, '', href);
}

// Back, forward, and addresses typed into the location bar.
window.addEventListener('popstate', () => navigate({ method: 'GET', url: currentUrl() }, false));

document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    const href = link.getAttribute('href')!;
    if (!href.startsWith('#/')) return;
    event.preventDefault();
    navigate({ method: 'GET', url: href.slice(1) }, true);
});

document.addEventListener('submit', async (event) => {
    if (event.defaultPrevented) return;
    const form = event.target as HTMLFormElement;
    const action = form.getAttribute('action');
    const url = action === null || action === '' ? currentUrl() : action.startsWith('#/') ? action.slice(1) : action;
    if (!isGameUrl(url)) return;
    event.preventDefault();
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | HTMLInputElement | null;
    const data = new FormData(form, submitter ?? undefined);
    if ((form.method || 'get').toLowerCase() === 'get') {
        const query = new URLSearchParams();
        for (const [name, value] of data) if (typeof value === 'string') query.append(name, value);
        const path = url.split('?')[0];
        const search = query.toString();
        navigate({ method: 'GET', url: path + (search ? '?' + search : '') }, true);
        return;
    }
    const fields: [string, string][] = [];
    const files: NonNullable<RequestInit['files']> = {};
    for (const [name, value] of data) {
        if (typeof value === 'string') fields.push([name, value]);
        else if (value.size > 0 || value.name) files[name] = { name: value.name, type: value.type, text: await value.text() };
    }
    navigate({ method: 'POST', url, form: fields, files }, true);
});

// ---- Showing a page -----------------------------------------------------------------------------------------------

// Listeners page scripts add to the document or window, removed when the next page is shown (a page's scripts run
// again each time it's shown, and would otherwise pile up).
let pageListeners: [EventTarget, string, EventListenerOrEventListenerObject, unknown][] = [];
// Likewise the intervals they start (the game clock's: see src/game/views/clock-bar.ts), which a page load would end.
let pageIntervals: ReturnType<typeof setInterval>[] = [];

function render(html: string, title: string): void {
    for (const [target, type, listener, options] of pageListeners) target.removeEventListener(type, listener, options as any);
    pageListeners = [];
    for (const interval of pageIntervals) clearInterval(interval);
    pageIntervals = [];
    document.querySelectorAll('.modal-backdrop, .offcanvas-backdrop, .tooltip').forEach((el) => el.remove());
    document.body.className = '';
    document.body.removeAttribute('style');

    document.title = title;
    document.body.innerHTML = html;
    rewriteLinks(document.body);
    runPageScripts();
    window.scrollTo(0, 0);
    const target = location.hash.includes('#', 1) ? document.getElementById(location.hash.split('#')[2]) : null;
    target?.scrollIntoView();
}

/** Links and form actions to game paths become fragment links. */
function rewriteLinks(root: ParentNode): void {
    root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
        const href = a.getAttribute('href')!;
        if (isGameUrl(href)) a.setAttribute('href', toHref(href));
    });
    root.querySelectorAll<HTMLFormElement>('form[action]').forEach((form) => {
        const action = form.getAttribute('action')!;
        if (isGameUrl(action)) form.setAttribute('action', toHref(action));
    });
}

/**
 * Runs the page's own scripts (inline <script>s don't run when HTML is inserted), then the site's (tables.js,
 * select-groups.js, tooltips), as the page loading would. Listeners they add for DOMContentLoaded run at once.
 */
function runPageScripts(): void {
    const doc = document as any;
    const win = window as any;
    const originals = [doc.addEventListener, win.addEventListener];
    const originalSetInterval = win.setInterval;
    const loaded: EventListenerOrEventListenerObject[] = [];
    const track = (target: EventTarget, original: typeof doc.addEventListener) =>
        function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: unknown) {
            if (type === 'DOMContentLoaded' || type === 'load') {
                loaded.push(listener);
                return;
            }
            pageListeners.push([target, type, listener, options]);
            return original.call(this, type, listener, options);
        };
    doc.addEventListener = track(document, originals[0]);
    win.addEventListener = track(window, originals[1]);
    win.setInterval = (...args: Parameters<typeof setInterval>) => {
        const interval = originalSetInterval.apply(window, args);
        pageIntervals.push(interval);
        return interval;
    };
    try {
        document.body.querySelectorAll('script').forEach((old) => {
            const script = document.createElement('script');
            for (const attr of old.attributes) script.setAttribute(attr.name, attr.value);
            script.textContent = old.textContent;
            old.replaceWith(script);
        });
        for (const code of [tablesJs, selectGroupsJs]) new Function(code)();
        document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => new bootstrap.Tooltip(el));
        for (const listener of loaded) {
            const event = new Event('DOMContentLoaded');
            if (typeof listener === 'function') listener.call(document, event);
            else listener.handleEvent(event);
        }
    } finally {
        doc.addEventListener = originals[0];
        win.addEventListener = originals[1];
        win.setInterval = originalSetInterval;
    }
}

function download(filename: string, type: string, data: string | Uint8Array): void {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!);
}

function showError(message: string): void {
    const box = document.createElement('div');
    box.className = 'alert alert-danger position-fixed bottom-0 start-50 translate-middle-x mb-5 shadow';
    box.style.zIndex = '2000';
    box.style.maxWidth = '40rem';
    box.innerHTML = `<strong>Something went wrong.</strong> ${escapeHtml(message)}
        <button type="button" class="btn-close float-end ms-2" aria-label="Close"></button>`;
    box.querySelector('button')!.addEventListener('click', () => box.remove());
    document.body.append(box);
}

function showStorageNotice(message: NoticeMessage): void {
    document.getElementById('frontier-storage-notice')?.remove();
    if (message.ok) return;
    const box = document.createElement('div');
    box.id = 'frontier-storage-notice';
    box.className = 'alert alert-warning position-fixed top-0 start-50 translate-middle-x mt-5 shadow';
    box.style.zIndex = '2000';
    box.textContent = message.message;
    document.body.append(box);
}

// ---- The game file (export, import, new game): the settings page's buttons ----------------------------------------

document.addEventListener('click', async (event) => {
    const button = (event.target as Element).closest?.('[data-frontier]') as HTMLElement | null;
    if (!button) return;
    event.preventDefault();
    const action = button.dataset.frontier;
    try {
        if (action === 'export') {
            const bytes = await send({ kind: 'export' });
            const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
            download(`frontier-${stamp}.sqlite`, 'application/vnd.sqlite3', bytes);
        } else if (action === 'import') {
            const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.sqlite,.db,application/vnd.sqlite3' });
            input.addEventListener('change', async () => {
                const file = input.files?.[0];
                if (!file || !confirm(`Replace this game with ${file.name}? The game you have now is lost unless you've exported it.`)) return;
                await send({ kind: 'import', bytes: new Uint8Array(await file.arrayBuffer()) });
                navigate({ method: 'GET', url: HOME }, true);
            });
            input.click();
        } else if (action === 'wipe') {
            if (!confirm('Delete this game and start a new one? It is lost unless you\'ve exported it.')) return;
            await send({ kind: 'wipe' });
            navigate({ method: 'GET', url: '/' }, true);
        }
    } catch (e) {
        showError((e as Error).message);
    }
});

// ---- Start --------------------------------------------------------------------------------------------------------

/** One tab plays at a time: two would each keep their own copy of the game, and overwrite each other's saves. */
async function start(): Promise<void> {
    installLayoutScripts(request);
    if (navigator.locks) {
        const granted = await navigator.locks.request('frontier-game', { ifAvailable: true }, async (lock) => {
            if (!lock) return false;
            navigate({ method: 'GET', url: currentUrl() }, false);
            // Hold the lock as long as this tab is open.
            await new Promise(() => {});
            return true;
        }).catch(() => null);
        if (granted === false) {
            document.body.innerHTML = `<main class="container py-5"><h1 class="h3">Frontier is open in another tab</h1>
                <p>Play it there, or close that tab and reload this one.</p></main>`;
        }
        return;
    }
    navigate({ method: 'GET', url: currentUrl() }, false);
}

start();
