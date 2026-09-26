/**
 * Messages between the page (src/shell) and the game's worker (src/worker/worker.ts). Each call carries an id; the
 * worker answers it once, with the result or an error.
 */
import type { RequestInit, Response } from '../core/http';

export type Call =
    | { kind: 'request'; init: RequestInit }
    /** The game's database file, to keep. */
    | { kind: 'export' }
    /** Replaces the game with a database file (from export). */
    | { kind: 'import'; bytes: Uint8Array }
    /** Throws the game away and starts a new one. */
    | { kind: 'wipe' };

export type Result<C extends Call> = C extends { kind: 'request' } ? Response : C extends { kind: 'export' } ? Uint8Array : null;

export type CallMessage = { id: number } & Call;

export type ReplyMessage =
    | { id: number; ok: true; result: unknown }
    | { id: number; ok: false; error: string };

/** Sent by the worker on its own: saving to the browser's storage failed (or works again). */
export type NoticeMessage = { id?: undefined; notice: 'storage'; ok: boolean; message: string };
