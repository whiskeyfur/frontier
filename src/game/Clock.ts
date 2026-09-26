// Upstream: game/src/Clock.php
import { Auth } from '../core/Auth';
import { onReset } from '../core/caches';
import { gmdate, int, strtotimeOrThrow } from '../core/php';

/**
 * The game's calendar. Admins move the game ahead by moving every stored date back (see Board::advance), so the real
 * clock's date stays "today" while the game lives through more days. Its weekdays have to move on with it: the game's
 * weekday for a date is that of the date the days advanced later (game_settings 'days_advanced'). Routines, a dam's
 * conceiving day and the tax day all go by it.
 */
export class Clock {
    // Days the game has been moved ahead, loaded once per request.
    private static advanced: number | null = null;

    static daysAdvanced(): number {
        if (Clock.advanced === null) {
            const value = Auth.db().value("SELECT value FROM game_settings WHERE name = 'days_advanced'");
            Clock.advanced = int(value || 0);
        }
        return Clock.advanced;
    }

    /**
     * The game's ISO weekday (1 = Monday) of date (today, if null).
     */
    static weekday(date: string | null = null): number {
        date ??= gmdate('Y-m-d');
        return int(gmdate('N', strtotimeOrThrow(date.substring(0, 10) + ' UTC +' + Clock.daysAdvanced() + ' days')));
    }

    /**
     * Counts another day the game was moved ahead (see Board::advance).
     */
    static advance(days = 1): void {
        Auth.db().run(
            "INSERT INTO game_settings (name, value) VALUES ('days_advanced', ?) ON CONFLICT (name) DO UPDATE SET value = value + excluded.value",
            [days],
        );
        Clock.advanced = null;
    }

    static forget(): void {
        Clock.advanced = null;
    }
}

onReset(() => {
    Clock.forget();
});
