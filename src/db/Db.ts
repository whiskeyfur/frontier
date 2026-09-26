/**
 * The game's database: SQLite (sql.js, in memory), with a small PDO-like API so ported code stays close to the PHP.
 *
 *   PHP                                                     TypeScript
 *   $db->query($sql)->fetchAll()                            db.all(sql)
 *   $stmt = $db->prepare($sql); $stmt->execute($params);
 *     $stmt->fetchAll()                                     db.all(sql, params)
 *     $stmt->fetch()                                        db.row(sql, params)          (null, not false)
 *     $stmt->fetchColumn()                                  db.value(sql, params)        (null, not false)
 *     $stmt->fetchAll(PDO::FETCH_COLUMN)                    db.column(sql, params)
 *     $stmt->fetchAll(PDO::FETCH_KEY_PAIR)                  db.pairs(sql, params)        (a Map, in row order)
 *     $stmt->fetchAll(PDO::FETCH_UNIQUE)                    db.unique(sql, params)       (a Map of first column => row)
 *     $stmt->rowCount() / $db->exec($sql)                   db.run(sql, params)          (rows changed)
 *   $db->lastInsertId()                                     db.lastInsertId()
 *   beginTransaction / commit / rollBack / inTransaction    the same names
 *
 * Parameters: an array for ? placeholders, or an object for :name placeholders (keys without the colon).
 * Booleans are bound as 1/0 and undefined as NULL. Rows are plain objects (column => value).
 */
import type { Database, SqlValue, Statement } from 'sql.js';
import { registerFunctions } from './functions';

export type Row = Record<string, any>;
export type Params = unknown[] | Record<string, unknown>;

export class DbError extends Error {
    constructor(message: string, public readonly sql: string) {
        super(`${message}\n  in: ${sql.replace(/\s+/g, ' ').trim()}`);
    }

    /** A UNIQUE or PRIMARY KEY violation (MariaDB's error 1062: Database::isDuplicateKey). */
    get isDuplicateKey(): boolean {
        return /UNIQUE constraint failed|PRIMARY KEY/.test(this.message);
    }
}

export class Db {
    private statements = new Map<string, Statement>();
    private depth = 0;

    constructor(public raw: Database) {
        this.configure();
    }

    /** Settings and functions a connection needs (again after export, which reopens it). */
    private configure(): void {
        this.raw.run('PRAGMA foreign_keys = ON');
        registerFunctions(this.raw);
    }

    private statement(sql: string, params?: Params): Statement {
        let stmt = this.statements.get(sql);
        try {
            if (!stmt) {
                stmt = this.raw.prepare(sql);
                this.statements.set(sql, stmt);
            }
            stmt.reset();
            if (params !== undefined) stmt.bind(bindable(params));
            return stmt;
        } catch (e) {
            throw new DbError((e as Error).message, sql);
        }
    }

    private *rows(sql: string, params?: Params): Generator<Row> {
        const stmt = this.statement(sql, params);
        try {
            while (stmt.step()) yield stmt.getAsObject() as Row;
        } catch (e) {
            throw e instanceof DbError ? e : new DbError((e as Error).message, sql);
        } finally {
            stmt.reset();
        }
    }

    all(sql: string, params?: Params): Row[] {
        return [...this.rows(sql, params)];
    }

    row(sql: string, params?: Params): Row | null {
        for (const row of this.rows(sql, params)) return row;
        return null;
    }

    value(sql: string, params?: Params): any {
        const stmt = this.statement(sql, params);
        try {
            return stmt.step() ? (stmt.get()[0] ?? null) : null;
        } catch (e) {
            throw new DbError((e as Error).message, sql);
        } finally {
            stmt.reset();
        }
    }

    column(sql: string, params?: Params): any[] {
        const stmt = this.statement(sql, params);
        const out: any[] = [];
        try {
            while (stmt.step()) out.push(stmt.get()[0]);
        } catch (e) {
            throw new DbError((e as Error).message, sql);
        } finally {
            stmt.reset();
        }
        return out;
    }

    /** First column => second column (PDO::FETCH_KEY_PAIR); a later row with the same key wins. */
    pairs(sql: string, params?: Params): Map<any, any> {
        const stmt = this.statement(sql, params);
        const out = new Map<any, any>();
        try {
            while (stmt.step()) {
                const [k, v] = stmt.get();
                out.set(k, v);
            }
        } catch (e) {
            throw new DbError((e as Error).message, sql);
        } finally {
            stmt.reset();
        }
        return out;
    }

    /** First column => the rest of the row (PDO::FETCH_UNIQUE). */
    unique(sql: string, params?: Params): Map<any, Row> {
        const out = new Map<any, Row>();
        for (const row of this.rows(sql, params)) {
            const [key, ...rest] = Object.keys(row);
            out.set(row[key], Object.fromEntries(rest.map((k) => [k, row[k]])));
        }
        return out;
    }

    /** Runs a statement; returns the number of rows it changed. */
    run(sql: string, params?: Params): number {
        const stmt = this.statement(sql, params);
        try {
            stmt.step();
        } catch (e) {
            throw new DbError((e as Error).message, sql);
        } finally {
            stmt.reset();
        }
        return this.raw.getRowsModified();
    }

    /** Runs a script of statements (no parameters). */
    exec(sql: string): void {
        try {
            this.raw.exec(sql);
        } catch (e) {
            throw new DbError((e as Error).message, sql.slice(0, 500));
        }
    }

    lastInsertId(): number {
        return Number(this.value('SELECT last_insert_rowid()'));
    }

    beginTransaction(): void {
        if (this.depth > 0) throw new Error('There is already an active transaction');
        this.raw.run('BEGIN IMMEDIATE');
        this.depth = 1;
    }

    commit(): void {
        if (this.depth === 0) throw new Error('There is no active transaction');
        this.raw.run('COMMIT');
        this.depth = 0;
    }

    rollBack(): void {
        if (this.depth === 0) throw new Error('There is no active transaction');
        this.raw.run('ROLLBACK');
        this.depth = 0;
    }

    inTransaction(): boolean {
        return this.depth > 0;
    }

    /** Runs fn in a transaction (or within the one already open), rolling back if it throws. */
    transaction<T>(fn: () => T): T {
        if (this.depth > 0) return fn();
        this.beginTransaction();
        try {
            const result = fn();
            this.commit();
            return result;
        } catch (e) {
            if (this.depth > 0) this.rollBack();
            throw e;
        }
    }

    /** Rows changed since the connection opened (to tell whether a request changed anything). */
    totalChanges(): number {
        return Number(this.value('SELECT total_changes()'));
    }

    /** The database file's bytes. sql.js reopens the connection to do it, so it's set up again. */
    export(): Uint8Array {
        this.forgetStatements();
        const bytes = this.raw.export();
        this.configure();
        return bytes;
    }

    close(): void {
        this.forgetStatements();
        this.raw.close();
    }

    private forgetStatements(): void {
        for (const stmt of this.statements.values()) stmt.free();
        this.statements.clear();
    }
}

function bindable(params: Params): SqlValue[] | Record<string, SqlValue> {
    const convert = (v: unknown): SqlValue => {
        if (v === undefined || v === null) return null;
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (typeof v === 'number' || typeof v === 'string' || v instanceof Uint8Array) return v;
        if (typeof v === 'bigint') return Number(v);
        throw new Error(`Can't bind ${Object.prototype.toString.call(v)} as a query parameter`);
    };
    if (Array.isArray(params)) return params.map(convert);
    return Object.fromEntries(Object.entries(params).map(([k, v]) => [k.startsWith(':') ? k : ':' + k, convert(v)]));
}
