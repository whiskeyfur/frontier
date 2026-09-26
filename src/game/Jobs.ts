// Upstream: game/src/Jobs.php
import { Auth, type User } from '../core/Auth';
import { array_rand, array_unique, ctype_digit, gmdate, int, random_int, spaceship, strtotimeOrThrow, trim } from '../core/php';
import type { Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Genders } from './Genders';
import { Names } from './Names';
import { Notifications } from './Notifications';
import { Preferences } from './Preferences';
import { Ranks } from './Ranks';
import { Schedules } from './Schedules';
import { Wallets } from './Wallets';

/**
 * Employment. A free anthro can't be bought; a player who wants one hires it on the job market for its asking daily
 * wage (WAGE_MIN to WAGE_MAX coins): the anthro they play becomes its employer and pays the wages from its wallet.
 * What an employee's work makes goes to its employer; an employee is hired to work, and its employer can't breed it.
 * Unplayed free anthros ask what their best skill pays (see expectedWage); players choose theirs,
 * or aren't looking for work; admins can supply workers with a trade (see supply). Wages are paid for each day in advance (the first when hired), by payDue() on each request; a
 * job ends when the employer can't pay, dismisses the employee, the employee quits, or loses its freedom.
 */
export class Jobs {
    static readonly WAGE_MIN = 1;
    // The most a worker asks: a Master's pay (see Schedules::PAY). And the most workers supplied at once. (WAGE_MAX is
    // a getter: it reads another class's constant, which may not be loaded yet when this one is.)
    static get WAGE_MAX(): number {
        return Schedules.PAY['Master'];
    }
    static readonly MAX_SUPPLY = 50;
    // A supplied worker's practice at its trade, in days (Novice to Journeyman: see Schedules::LEVELS).
    static readonly SUPPLY_PRACTICE = [1, 40];

    /**
     * What a worker can expect to ask a day for work at level (see Schedules::level; null: no skill learned): what
     * that work pays (Schedules::PAY; WAGE_MIN for unskilled work).
     */
    static expectedWage(level: string | null): number {
        const pay = level === null ? Jobs.WAGE_MIN : (Schedules.PAY[level] ?? Jobs.WAGE_MIN);
        return Math.max(Jobs.WAGE_MIN, Math.min(Jobs.WAGE_MAX, pay));
    }

    /**
     * What the anthro can expect to ask (see expectedWage), by the skill it's practised most.
     */
    static skillWage(anthroId: number): number {
        const practice = Auth.db().value('SELECT MAX(practice) FROM game_anthro_skills WHERE anthro_id = ? AND practice >= ?', [anthroId, Schedules.WORK_MIN_PRACTICE]);
        return Jobs.expectedWage(practice ? Schedules.level(int(practice)) : null);
    }

    /**
     * Gives every unplayed, free, untitled anthro without an asking wage one by its best skill (see skillWage), so it's
     * looking for work. (Title holders don't look for work.)
     */
    static assignWages(): void {
        const db = Auth.db();
        for (const row of db.all(
            'SELECT id FROM game_anthros WHERE wage IS NULL AND owner_id = id AND player_id IS NULL AND title_rank IS NULL AND died_at IS NULL',
        )) {
            db.run('UPDATE game_anthros SET wage = ? WHERE id = ?', [Jobs.skillWage(int(row.id)), row.id]);
        }
    }

    /**
     * Admin: count new free, grown anthros looking for work: random gender, species and name, each practised at a
     * trade (the skill skillId, or a random one; SUPPLY_PRACTICE days of it), asking wage a day (or what its trade
     * pays: see expectedWage).
     * Returns [how many, null] or [null, error message].
     */
    static supply(count: number, skillId: number | null, wage: number | null): [number | null, string | null] {
        const skills = Schedules.skills();
        const species = Auth.db().column('SELECT id FROM game_species');
        if (count < 1 || count > Jobs.MAX_SUPPLY) {
            return [null, 'Supply 1 to ' + Jobs.MAX_SUPPLY + ' workers at a time.'];
        }
        if (skillId !== null && !skills.has(skillId)) {
            return [null, 'Choose a skill, or a random one.'];
        }
        if (wage !== null && (wage < Jobs.WAGE_MIN || wage > Jobs.WAGE_MAX)) {
            return [null, 'Wages are ' + Jobs.WAGE_MIN + ' to ' + Jobs.WAGE_MAX + ' coins a day.'];
        }
        if (!skills.size || !species.length) {
            return [null, 'The game needs species and skills first.'];
        }
        const db = Auth.db();
        const insert = 'INSERT INTO game_anthros (name, gender_id, species_id, birthdate, fertile_on, wage) VALUES (?, ?, ?, ?, ?, ?)';
        const practice = 'INSERT INTO game_anthro_skills (anthro_id, skill_id, practice) VALUES (?, ?, ?)';
        for (let i = 0; i < count; i++) {
            const genderId = Genders.randomBirthId();
            const birthdate = Anthros.randomAdultBirthdate();
            const days = random_int(Jobs.SUPPLY_PRACTICE[0], Jobs.SUPPLY_PRACTICE[1]);
            db.run(insert, [
                Names.random(0, Genders.find(genderId)!.presents_as), genderId, species[array_rand(species)],
                birthdate, Anthros.randomFertileOn(birthdate), wage ?? Jobs.expectedWage(Schedules.level(days)),
            ]);
            const id = db.lastInsertId();
            Anthros.free(id);
            db.run(practice, [id, skillId ?? array_rand(skills), days]);
        }
        Ranks.assignLieges();
        return [count, null];
    }

    /**
     * Hires each anthro in ids at its asking wage. Returns {hired: [names], skipped: [reasons]}.
     */
    static hire(user: User, ids: unknown[]): { hired: string[]; skipped: string[] } {
        const result: { hired: string[]; skipped: string[] } = { hired: [], skipped: [] };
        for (const id of array_unique(ids.map(int))) {
            const anthro = Anthros.findAny(id);
            const error = Jobs.hireOne(user, id);
            if (error === null) {
                result.hired.push(anthro!.name);
            } else {
                result.skipped.push((anthro ? `${anthro.name}: ` : '') + error);
            }
        }
        return result;
    }

    /**
     * Hires one anthro, paying its first day. Returns an error message, or null.
     */
    static hireOne(user: User, anthroId: number): string | null {
        const payer = Wallets.anthroFor(user.id);
        if (payer === null) {
            return 'Create or become an anthro first: wages are paid from its wallet.';
        }
        const db = Auth.db();
        db.beginTransaction();
        // (Upstream locks the anthro here with SELECT ... FOR UPDATE: nothing to do in SQLite.)
        const anthro = Anthros.findAny(anthroId)!;
        let error: string | null;
        if (!anthro) {
            error = 'That anthro no longer exists.';
        } else if (anthro.id === payer) {
            error = "You can't hire yourself.";
        } else if (anthro.employer_id != null) {
            error = 'Already employed.';
        } else if (anthro.wage == null || !Anthros.isFree(anthro) || anthro.auction_id != null) {
            error = 'Not looking for work.';
        } else {
            error = null;
        }
        if (error) {
            db.rollBack();
            return error;
        }
        const wage = int(anthro.wage);
        if (!Wallets.change(payer, -wage, `Wages for ${anthro.name} (first day)`, null, user.id)) {
            db.rollBack();
            return 'You need ' + Wallets.format(wage) + ' for the first day but have ' + Wallets.format(Wallets.balance(payer)) + '.';
        }
        Wallets.change(anthro.id, wage, 'Wages from ' + Jobs.employerName(payer));
        db.run(
            `UPDATE game_anthros SET employer_id = ?, employed_wage = ?, employed_since = UTC_TIMESTAMP(), paid_until = UTC_DATE()
             WHERE id = ?`,
            [payer, wage, anthro.id],
        );
        db.commit();
        // Hired for the work it offered: it starts on that every day, until its employer plans otherwise.
        const offered = Jobs.offered(anthro);
        if (offered && !Schedules.hasRoutine(anthro.id)) {
            const week: Record<number, Row> = {};
            for (let day = 1; day <= 7; day++) {
                week[day] = { activity: 'work', detail: 'o:' + offered.id };
            }
            Schedules.setWeekly(user, Anthros.findAny(anthro.id)!, week);
        }
        Notifications.toAnthro(anthro.id, Jobs.employerName(payer) + ' hired you for ' + Wallets.format(wage) + ' a day'
            + (offered ? ` to work as ${offered.title}.` : '.'), '/game/home');
        return null;
    }

    /**
     * The employer lets an employee go. Returns an error message, or null.
     */
    static dismiss(user: User, anthroId: number): string | null {
        const anthro = Anthros.findAny(anthroId);
        if (!anthro || anthro.employer_id == null || anthro.employer_id !== Wallets.anthroFor(user.id)) {
            return "That anthro doesn't work for you.";
        }
        Jobs.end(anthro, Jobs.employerName(anthro.employer_id) + ' let you go.', null);
        return null;
    }

    /**
     * The player's anthro quits its job. Returns an error message, or null.
     */
    static quit(user: User): string | null {
        const anthro = Anthros.player(user.id);
        if (!anthro || anthro.employer_id == null) {
            return "You don't have a job.";
        }
        Jobs.end(anthro, null, `${anthro.name} quit working for you.`);
        return null;
    }

    /**
     * The player sets the daily wage they'd work for, or stops looking for work (''), and the work they offer. Returns an
     * error message, or null.
     */
    static setAsking(user: User, wage: string, occupationId: number | null = null): string | null {
        const anthro = Anthros.player(user.id);
        if (!anthro) {
            return "You don't play an anthro.";
        }
        wage = trim(wage);
        if (wage !== '' && (!ctype_digit(wage) || int(wage) < Jobs.WAGE_MIN || int(wage) > Jobs.WAGE_MAX)) {
            return 'The wage must be ' + Jobs.WAGE_MIN + ' to ' + Jobs.WAGE_MAX + ' coins a day, or empty if you are not looking for work.';
        }
        if (occupationId !== null && !Jobs.offerable(anthro).has(occupationId)) {
            return 'Choose work you\'ve learned the skill for (train at it first).';
        }
        Auth.db().run('UPDATE game_anthros SET wage = ?, seeking_occupation_id = ? WHERE id = ?',
            [wage === '' ? null : int(wage), occupationId, anthro.id]);
        return null;
    }

    /**
     * The work the anthro can offer on the job market: the occupations (of its player's era) whose skill it has learned
     * (see Schedules::learned), a Map of id => occupation + 'level' and 'wage' (what it can expect to ask: see
     * expectedWage), best-practised skill first.
     */
    static offerable(anthro: Row): Map<number, Row> {
        const practice = Auth.db().pairs(
            'SELECT skill_id, practice FROM game_anthro_skills WHERE anthro_id = ? AND practice >= ?',
            [anthro.id, Schedules.WORK_MIN_PRACTICE],
        );
        const offer: [number, Row][] = [];
        for (const [id, occupation] of Schedules.occupations(Preferences.era(anthro.player_id))) {
            if (practice.has(occupation.skill_id)) {
                const level = Schedules.level(int(practice.get(occupation.skill_id)));
                offer.push([id, { ...occupation, level, practice: int(practice.get(occupation.skill_id)), wage: Jobs.expectedWage(level) }]);
            }
        }
        offer.sort(([, a], [, b]) => spaceship(b.practice, a.practice) || spaceship(a.title, b.title));
        return new Map(offer);
    }

    /**
     * The work a job-seeker offers (see setAsking), with its level at it, or null if it offers nothing in particular.
     */
    static offered(anthro: Row): Row | null {
        return anthro.seeking_occupation_id == null ? null : (Jobs.offerable(anthro).get(int(anthro.seeking_occupation_id)) ?? null);
    }

    /**
     * Ends the anthro's job, if it has one, and tells the employee and the employer (null: no message).
     */
    static end(anthro: Row, toEmployee: string | null, toEmployer: string | null): void {
        if (anthro.employer_id == null) {
            return;
        }
        Auth.db().run(
            'UPDATE game_anthros SET employer_id = NULL, employed_wage = NULL, employed_since = NULL, paid_until = NULL WHERE id = ?',
            [anthro.id],
        );
        if (toEmployee !== null) {
            Notifications.toAnthro(anthro.id, toEmployee, '/game/home');
        }
        if (toEmployer !== null) {
            Notifications.toAnthro(anthro.employer_id, toEmployer, '/game/market/jobs');
        }
    }

    /**
     * Pays every day's wages that have come due since each job was last paid. A job whose employer can't pay ends
     * (one whose employer nobody plays any more goes on, while it can pay). The game runs this on each request.
     * Returns how many days were paid.
     */
    static payDue(): number {
        Jobs.assignWages();
        const db = Auth.db();
        const due = db.column('SELECT id FROM game_anthros WHERE employer_id IS NOT NULL AND paid_until < UTC_DATE()');
        let paid = 0;
        for (const id of due) {
            db.beginTransaction();
            // (Upstream locks the employee here with SELECT ... FOR UPDATE, so two requests can't pay the same day
            // twice: nothing to do in SQLite.)
            const anthro = Anthros.findAny(int(id))!;
            while (anthro.employer_id != null && anthro.paid_until < gmdate('Y-m-d')) {
                const payer = anthro.employer_id;
                const wage = int(anthro.employed_wage);
                const day = gmdate('Y-m-d', strtotimeOrThrow(anthro.paid_until + ' +1 day'));
                if (!Wallets.change(payer, -wage, `Wages for ${anthro.name} (${day})`)) {
                    Jobs.end(anthro, 'Your employer couldn\'t pay your wages, so your job ended.',
                        `You couldn't pay ${anthro.name}'s wages of ` + Wallets.format(wage) + ', so they stopped working for you.');
                    break;
                }
                Wallets.change(anthro.id, wage, 'Wages from ' + Jobs.employerName(anthro.employer_id) + ` (${day})`);
                db.run('UPDATE game_anthros SET paid_until = ? WHERE id = ?', [day, anthro.id]);
                anthro.paid_until = day;
                paid++;
            }
            db.commit();
        }
        return paid;
    }

    /**
     * The employing anthro's name.
     */
    private static employerName(anthroId: number): string {
        return Anthros.findAny(anthroId)?.name ?? 'Your employer';
    }
}
