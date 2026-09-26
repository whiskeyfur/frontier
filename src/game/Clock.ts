// Upstream: game/src/Clock.php
import { Auth } from '../core/Auth';
import { onReset } from '../core/caches';
import { float, gmdate, int, intdiv, strtotimeOrThrow, time } from '../core/php';

/** The clock's anchor (see Clock.anchor). */
type Anchor = { game: number; real: number; rate: number; paused: boolean };

/**
 * The game's clock, apart from the real one. Game time runs from an anchor (a game time and the real moment it was, in
 * game_settings 'clock_game' and 'clock_real'; seconds from the epoch, the game's before it) at a rate: game days per
 * real day (RATE_MIN to RATE_MAX). Each player may ask for a rate (see Preferences); the game runs at the slowest asked
 * for by anyone playing an anthro, or DEFAULT_RATE. When it changes, the anchor moves to now (see sync), so time that
 * has passed keeps the rate it passed at.
 *
 * While the game is down for maintenance the clock stands still (see pause): no days go by.
 *
 * The game's business is done once for each game day (see Board::runDaily), in order, however many have passed; while
 * a day's is being done, "today" is that day (see processing). A reset starts the clock on a date of the admins'
 * choosing (START by default), and admins can move it ahead (see advance). Routines, a dam's conceiving day and the tax
 * day go by the game's weekdays.
 *
 * Game dates and times are in the game's own columns (birthdates, due dates, schedules...). What happens between
 * people keeps real time: auctions, bids, messages, the ledger.
 *
 * (Here there's no maintenance mode (see App.ADMIN_PAGES), so nothing pauses the clock but tests; pause and unpause
 * are ported as they are.)
 */
export class Clock {
    static readonly START = '1200-01-01';
    static readonly DEFAULT_RATE = 1.0;
    static readonly RATE_MIN = 0.25;
    static readonly RATE_MAX = 24.0;
    // The paces offered as buttons (see game::clock-bar); any from RATE_MIN to RATE_MAX can be asked for in Preferences.
    static readonly PACES = [0.25, 0.5, 1, 2, 4, 7, 12, 24];
    // The most game days one request catches up on; the rest wait for the next.
    static readonly MAX_CATCH_UP = 366;

    // The anchor and rate, loaded once per request; the day being done, while it's done.
    private static anchorRow: Anchor | null = null;
    private static processingDay: string | null = null;

    /**
     * The game's time now, in seconds from the epoch (negative before 1970): the start of the day being done, while one
     * is (see processing).
     */
    static time(): number {
        if (Clock.processingDay !== null) {
            return Clock.parse(Clock.processingDay);
        }
        const anchor = Clock.anchor();
        return anchor.paused ? anchor.game : anchor.game + Math.floor((time() - anchor.real) * anchor.rate);
    }

    /**
     * The game's date today ('Y-m-d'), or days from it.
     */
    static today(days = 0): string {
        return gmdate('Y-m-d', Clock.time() + days * 86400);
    }

    /**
     * The game's date and time now ('Y-m-d H:i:s').
     */
    static now(): string {
        return gmdate('Y-m-d H:i:s', Clock.time());
    }

    /**
     * Today (or days from it), and now, as SQL literals, for queries.
     */
    static sqlToday(days = 0): string {
        return "'" + Clock.today(days) + "'";
    }

    static sqlNow(): string {
        return "'" + Clock.now() + "'";
    }

    /**
     * date ('Y-m-d', or with a time) moved days days ('Y-m-d').
     */
    static add(date: string, days: number): string {
        return gmdate('Y-m-d', Clock.parse(date) + days * 86400);
    }

    /**
     * Whole days from from to to (dates or times; to today if null).
     */
    static daysBetween(from: string, to: string | null = null): number {
        return intdiv(Clock.parse((to ?? Clock.today()).substring(0, 10)) - Clock.parse(from.substring(0, 10)), 86400);
    }

    /**
     * A game date or time ('Y-m-d', or 'Y-m-d H:i:s') in seconds from the epoch.
     */
    static parse(when: string): number {
        return strtotimeOrThrow((when.length <= 10 ? when + ' 00:00:00' : when) + ' UTC');
    }

    /**
     * The game's ISO weekday (1 = Monday) of date (today, if null).
     */
    static weekday(date: string | null = null): number {
        return int(gmdate('N', Clock.parse((date ?? Clock.today()).substring(0, 10))));
    }

    /**
     * Game days per real day, now.
     */
    static rate(): number {
        return Clock.anchor().rate;
    }

    /**
     * The rate the players ask for: the slowest asked for by anyone playing an anthro (see Preferences), or
     * DEFAULT_RATE if nobody has asked.
     */
    static wanted(): number {
        const slowest = Auth.db().value(
            `SELECT MIN(p.time_rate) FROM game_preferences p JOIN game_anthros a ON a.player_id = p.user_id
             WHERE p.time_rate IS NOT NULL AND a.died_at IS NULL`,
        );
        return slowest === null ? Clock.DEFAULT_RATE : float(slowest);
    }

    /**
     * Moves the anchor to now at the players' rate, if it's changed (see wanted): time already passed keeps the rate
     * it passed at. The game runs this on each request.
     */
    static sync(): void {
        const wanted = Clock.wanted();
        if (Math.abs(wanted - Clock.rate()) > 1e-9) {
            Clock.setAnchor(Clock.time(), time(), wanted);
        }
    }

    /**
     * Admin: moves the game days days ahead (the days' business is done as the game catches up: see Board::runDaily).
     */
    static advance(days: number): void {
        Clock.setAnchor(Clock.time() + days * 86400, time(), Clock.rate());
    }

    /**
     * Stops the clock where it is (the game going down for maintenance: see \Maintenance), until resumed (unpause).
     */
    static pause(): void {
        if (!Clock.anchor().paused) {
            Clock.setAnchor(Clock.time(), time(), Clock.rate());
            Clock.setting('clock_paused', '1');
            Clock.anchorRow!.paused = true;
        }
    }

    /**
     * Starts a paused clock again from where it stood.
     */
    static unpause(): void {
        if (Clock.anchor().paused) {
            Auth.db().exec("DELETE FROM game_settings WHERE name = 'clock_paused'");
            Clock.setAnchor(Clock.anchor().game, time(), Clock.rate());
        }
    }

    /**
     * Carries on from game time time (a saved game's, restored) from now.
     */
    static resume(gameTime: number): void {
        Clock.processingDay = null;
        Clock.setAnchor(gameTime, time(), Clock.wanted());
    }

    /**
     * Starts the clock over at the start of date (a reset): its business is done from that day on.
     */
    static start(date: string): void {
        Clock.processingDay = null;
        Clock.setAnchor(Clock.parse(date), time(), Clock.wanted());
        Clock.setting('clock_day', Clock.add(date, -1));
    }

    /**
     * The last game day whose business is done (see Board::runDaily), or null before the first.
     */
    static doneThrough(): string | null {
        const day = Auth.db().value("SELECT value FROM game_settings WHERE name = 'clock_day'");
        return day === null ? null : String(day);
    }

    /**
     * Marks a game day's business done (never moving back).
     */
    static done(day: string): void {
        // (The WHERE is here, not upstream: MariaDB doesn't count a row updated to what it was as changed, and the
        // worker saves the game after a request that changed anything; this runs on every request.)
        Auth.db().run(
            "INSERT INTO game_settings (name, value) VALUES ('clock_day', ?) ON CONFLICT (name) DO UPDATE SET value = GREATEST(value, excluded.value)"
            + ' WHERE value IS NOT GREATEST(value, excluded.value)',
            [day],
        );
    }

    /**
     * While a day's business is being done, "today" is that day (day), and "now" its start; null goes back to now.
     */
    static processing(day: string | null): void {
        Clock.processingDay = day;
        Clock.bind();
    }

    /**
     * Gives the database connection the game's time (@game_now), for the rows stamped when they're made (see
     * Schema::gameClock, here src/db/triggers.sql).
     */
    static bind(): void {
        // Upstream: SET @game_now = '...' (see Db.setVariable).
        Auth.db().setVariable('game_now', Clock.now());
    }

    static forget(): void {
        Clock.anchorRow = null;
        Clock.processingDay = null;
    }

    private static anchor(): Anchor {
        if (Clock.anchorRow === null) {
            const rows = Auth.db().pairs("SELECT name, value FROM game_settings WHERE name IN ('clock_game', 'clock_real', 'clock_rate', 'clock_paused')");
            if (!rows.has('clock_game')) {
                // Never started: the game begins now, at the start.
                Clock.setAnchor(Clock.parse(Clock.START), time(), Clock.DEFAULT_RATE);
                return Clock.anchorRow!;
            }
            Clock.anchorRow = { game: int(rows.get('clock_game')), real: int(rows.get('clock_real')), rate: float(rows.get('clock_rate') ?? Clock.DEFAULT_RATE),
                paused: rows.has('clock_paused') };
            Clock.bind();
        }
        return Clock.anchorRow;
    }

    private static setAnchor(game: number, real: number, rate: number): void {
        Clock.setting('clock_game', String(game));
        Clock.setting('clock_real', String(real));
        Clock.setting('clock_rate', String(rate));
        Clock.anchorRow = { game, real, rate, paused: Clock.anchorRow?.paused ?? false };
        Clock.bind();
    }

    private static setting(name: string, value: string): void {
        Auth.db().run('INSERT INTO game_settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value', [name, value]);
    }
}

onReset(() => {
    Clock.forget();
});
