// Upstream: game/src/Preferences.php
import { Auth } from '../core/Auth';
import type { Row } from '../db/Db';
import { Anthros } from './Anthros';

/**
 * Each player's game preferences (game_preferences; kept across resets). For now, the era they play in:
 *  - the Dark Ages (the default);
 *  - the Renaissance: more artistic skills and occupations to train and work at (see Schedules::RENAISSANCE_SKILLS),
 *    but no breeding attempts with an anthro younger than MIN_BREEDING_WEEKS.
 * The era of whoever does something (breeds, flirts, plans a schedule) is the one that applies.
 */
export class Preferences {
    static readonly ERAS: Readonly<Record<string, string>> = { dark: 'Dark Ages', renaissance: 'Renaissance' };
    // The youngest anthro, in weeks, the Renaissance lets anyone try to breed.
    static readonly MIN_BREEDING_WEEKS: Readonly<Record<string, number>> = { renaissance: 14 };

    /**
     * The player's era ('dark' for someone with no preference, or no player at all).
     */
    static era(userId: number | null): string {
        if (userId === null) {
            return 'dark';
        }
        const era = Auth.db().value('SELECT era FROM game_preferences WHERE user_id = ?', [userId]);
        return era !== null && Object.hasOwn(Preferences.ERAS, era) ? era : 'dark';
    }

    /**
     * Saves the player's era. Returns an error message, or null.
     */
    static setEra(user: Row, era: string): string | null {
        if (!Object.hasOwn(Preferences.ERAS, era)) {
            return 'Choose the Dark Ages or the Renaissance.';
        }
        Auth.db().run(
            'INSERT INTO game_preferences (user_id, era) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET era = excluded.era',
            [user.id, era],
        );
        return null;
    }

    /**
     * Why the player's era doesn't allow a breeding attempt between these anthros (one is too young), or null.
     */
    static breedingRefusal(userId: number | null, ...anthros: Row[]): string | null {
        const weeks = Preferences.MIN_BREEDING_WEEKS[Preferences.era(userId)] ?? null;
        if (weeks === null) {
            return null;
        }
        for (const anthro of anthros) {
            const age = Anthros.ageWeeks(anthro.birthdate);
            if (age !== null && age < weeks) {
                return `${anthro.name} is too young: in the ` + Preferences.ERAS[Preferences.era(userId)] + `, no one is bred before ${weeks} weeks old.`;
            }
        }
        return null;
    }
}
