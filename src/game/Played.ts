// Upstream: game/src/Played.php
import { Auth } from '../core/Auth';
import { onReset } from '../core/caches';
import { array_fill, array_unique, spaceship } from '../core/php';

/**
 * Which anthros on the page being drawn are played, and by whom: something only admins may know. Lists note the
 * played anthros they show (see the assets.anthro-link and assets.anthro-option views) instead of marking them
 * inline, and the admin panel lists them (see layouts.admin-panel). App::render starts each page with none.
 */
export class Played {
    // anthro id => [name, player's user id], in the order first shown.
    private static anthros = new Map<number, [string, number]>();

    static reset(): void {
        Played.anthros = new Map();
    }

    /**
     * Notes that the page shows the anthro, if it's played (playerId null: it isn't).
     */
    static note(anthroId: number, name: string, playerId: number | null): void {
        if (playerId !== null && !Played.anthros.has(anthroId)) {
            Played.anthros.set(anthroId, [name, playerId]);
        }
    }

    /**
     * The played anthros noted on this page: [{ id, name, player: username or null }, ...], by name.
     */
    static onPage(): { id: number; name: string; player: string | null }[] {
        if (!Played.anthros.size) {
            return [];
        }
        const playerIds = array_unique([...Played.anthros.values()].map((a) => a[1]));
        const usernames = Auth.db().pairs(
            'SELECT id, username FROM users WHERE id IN (' + array_fill(playerIds.length, '?').join(', ') + ')',
            playerIds,
        );
        const list: { id: number; name: string; player: string | null }[] = [];
        for (const [id, [name, playerId]] of Played.anthros) {
            list.push({ id, name, player: usernames.get(playerId) ?? null });
        }
        list.sort((a, b) => strnatcasecmp(a.name, b.name) || spaceship(a.id, b.id));
        return list;
    }
}

/**
 * PHP strnatcasecmp(): compares case-insensitively, reading runs of digits as numbers ("Kit2" before "Kit10").
 */
function strnatcasecmp(a: string, b: string): number {
    const x = a.toLowerCase().match(/\d+|\D+/g) ?? [];
    const y = b.toLowerCase().match(/\d+|\D+/g) ?? [];
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const p = x[i], q = y[i];
        if (/^\d/.test(p) && /^\d/.test(q)) {
            const d = Number(p) - Number(q);
            if (d) return d < 0 ? -1 : 1;
        } else if (p !== q) {
            return p < q ? -1 : 1;
        }
    }
    return spaceship(x.length, y.length);
}

onReset(() => {
    Played.reset();
});
