/**
 * The site's accounts, as far as the game needs them (upstream's Auth and Roles). In the browser there's one account,
 * the person playing, who is both a player and an admin; tests make as many as they like.
 */
import type { Db, Row } from '../db/Db';
import { Session } from './Session';

export type User = Row & { id: number; username: string; roles: string[] };

export const Roles = {
    ADMIN: 'admin',
    PLAYER: 'player',
} as const;

let current: Db | null = null;

export class Auth {
    /** The game's database (upstream: the site's PDO connection). */
    static db(): Db {
        if (!current) throw new Error('No database is open');
        return current;
    }

    static setDb(db: Db | null): void {
        current = db;
    }

    /** The logged-in user (the session's), or null. */
    static user(): User | null {
        const id = Session.data.user_id;
        return typeof id === 'number' ? Auth.find(id) : null;
    }

    static find(id: number): User | null {
        const row = Auth.db().row('SELECT * FROM users WHERE id = ?', [id]);
        return row ? withRoles(row) : null;
    }

    static allUsers(): User[] {
        return Auth.db().all('SELECT * FROM users ORDER BY id').map(withRoles);
    }

    /** Makes an account; returns it. */
    static create(username: string, roles: string[] = [Roles.PLAYER]): User {
        Auth.db().run('INSERT INTO users (username, is_admin, is_player) VALUES (?, ?, ?)',
            [username, roles.includes(Roles.ADMIN), roles.includes(Roles.PLAYER)]);
        return Auth.find(Auth.db().lastInsertId())!;
    }

    /** Deletes an account; returns whether there was one. The database clears or deletes what refers to it. */
    static delete(id: number): boolean {
        return Auth.db().run('DELETE FROM users WHERE id = ?', [id]) > 0;
    }

    static isAdmin(user: Row | null | undefined): boolean {
        return !!user && (user.roles ?? []).includes(Roles.ADMIN);
    }

    static isPlayer(user: Row | null | undefined): boolean {
        return !!user && (user.roles ?? []).includes(Roles.PLAYER);
    }

    /** Forms don't need CSRF tokens here (nothing outside the page can post to the game), but the views still carry one. */
    static csrfToken(): string {
        return 'local';
    }

    static checkCsrf(_token: unknown): boolean {
        return true;
    }
}

function withRoles(row: Row): User {
    const roles: string[] = [];
    if (row.is_admin) roles.push(Roles.ADMIN);
    if (row.is_player) roles.push(Roles.PLAYER);
    return { ...row, roles, password_expired: false } as unknown as User;
}
