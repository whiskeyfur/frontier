/**
 * The game's "server": a Web Worker that holds the game's SQLite database and answers the page's requests the way
 * upstream's PHP answers the browser (src/site/router.ts decides what each request is). After a request that
 * changed the database, it's saved to the browser's storage (IndexedDB), a moment later.
 */
/// <reference lib="webworker" />
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Auth } from '../core/Auth';
import { resetCaches } from '../core/caches';
import { Request } from '../core/http';
import { Session } from '../core/Session';
import type { Db } from '../db/Db';
import { createDatabase, openDatabase } from '../db/open';
import { route } from '../site/router';
import type { CallMessage, NoticeMessage, ReplyMessage } from './protocol';
import { deleteGame, loadGame, saveGame } from './storage';

declare const self: DedicatedWorkerGlobalScope;

const SAVE_DELAY_MS = 250;

let SQL: SqlJsStatic;
let db: Db;
let savedChanges = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let storageOk = true;

const ready = (async () => {
    SQL = await initSqlJs({ locateFile: () => wasmUrl });
    let bytes: Uint8Array | null = null;
    try {
        bytes = await loadGame();
    } catch (e) {
        notice(false, `The game can't be loaded from this browser's storage (${(e as Error).message}). A new game has started; use Export to keep it.`);
    }
    use(bytes ? openDatabase(SQL, bytes) : createDatabase(SQL));
    if (!bytes) scheduleSave();
})();

/** Makes a database the game's. */
function use(next: Db): void {
    if (db) db.close();
    db = next;
    Auth.setDb(db);
    resetCaches();
    Session.reset();
    savedChanges = db.totalChanges();
}

function notice(ok: boolean, message: string): void {
    self.postMessage({ notice: 'storage', ok, message } satisfies NoticeMessage);
}

function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

async function save(): Promise<void> {
    saveTimer = null;
    if (db.inTransaction()) {
        scheduleSave();
        return;
    }
    const bytes = db.export();
    savedChanges = db.totalChanges();
    try {
        await saveGame(bytes);
        if (!storageOk) notice(true, 'The game is being saved in this browser again.');
        storageOk = true;
    } catch (e) {
        if (storageOk) notice(false, `The game couldn't be saved in this browser (${(e as Error).message}). Use Export to keep it.`);
        storageOk = false;
    }
}

self.onmessage = async (event: MessageEvent<CallMessage>) => {
    const call = event.data;
    await ready;
    let reply: ReplyMessage;
    try {
        let result: unknown = null;
        switch (call.kind) {
            case 'request':
                result = route(new Request(call.init));
                if (db.inTransaction()) {
                    // A handler that failed half way: undo it, as a PHP request's connection would.
                    db.rollBack();
                }
                break;
            case 'export':
                if (saveTimer) clearTimeout(saveTimer);
                await save();
                result = db.export();
                break;
            case 'import':
                use(openDatabase(SQL, call.bytes));
                await save();
                break;
            case 'wipe':
                await deleteGame();
                use(createDatabase(SQL));
                await save();
                break;
        }
        reply = { id: call.id, ok: true, result };
    } catch (e) {
        if (db.inTransaction()) db.rollBack();
        console.error(e);
        reply = { id: call.id, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (db.totalChanges() !== savedChanges) scheduleSave();
    self.postMessage(reply, reply.ok && reply.result instanceof Uint8Array ? [reply.result.buffer] : []);
};
