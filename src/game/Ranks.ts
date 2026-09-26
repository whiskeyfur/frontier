// Upstream: game/src/Ranks.php
import { Auth, type User } from '../core/Auth';
import { onReset } from '../core/caches';
import { array_chunk, array_column, array_fill, array_rand, array_sum, float, int, mb_strlen, random_int, range, shuffle, trim } from '../core/php';
import type { Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Baronies } from './Baronies';
import { Clock } from './Clock';
import { Fiefs } from './Fiefs';
import { Genders } from './Genders';
import { Land } from './Land';
import { Marriages } from './Marriages';
import { Names } from './Names';
import { Notifications } from './Notifications';
import { Schedules } from './Schedules';

/** A row of game_ranks (see Ranks.all). */
export type Rank = { rank: number; name: string; female_name: string; is_noble: boolean; is_hereditary: boolean };

/**
 * A node of the court's tree (see Ranks.structure): a titled anthro (a row of Ranks.titled) with 'commoners', 'owned',
 * 'children' and 'branchCommoners'.
 */
export type CourtNode = Row & { commoners: number; owned: number; children: CourtNode[]; branchCommoners?: number };

/**
 * Social rank, from king down to slave. A free anthro (see Anthros::isFree) is a commoner unless it holds a title
 * (knight and up), granted by admins or by the crown: the King and the Queen, who hold the top rank together and grant
 * titles below it. Any anthro owned by someone else is a slave, and an anthro that loses its freedom loses its title.
 * A free anthro can swear to a liege of higher rank: if its land is forfeit to the crown, it goes to its liege, or
 * else to someone of the next rank up that's held. Commoners are always sworn to a noble, and owned anthros to their
 * owners (see assignLieges).
 *
 * The titles are in game_ranks, where admins rename them and mark them noble or hereditary. Noble ranks are the
 * peerage, which players can't become (see Anthros::become). A hereditary title passes, when its holder loses its
 * freedom, to the holder's eldest free child (see successor); other titles are simply lost.
 */
export class Ranks {
    static readonly KING = 9;
    static readonly BARONET = 3;
    static readonly KNIGHT = 2;
    // The land a free anthro needs to take up the rank of baronet, and each rank above it up to duke needs
    // ACRES_FACTOR times the one below's (see acresFor, assumable). Its land counts that of everyone sworn to it, and
    // everyone sworn to them (see acresHeld).
    static readonly BARONET_ACRES = 500;
    static readonly ACRES_FACTOR = 3;
    // A reset's court: the King and Queen, and under each titled anthro this many vassals of the next rank down.
    static readonly COURT_VASSALS = 2;
    // Commoners a reset swears directly to each title holder (a baronet with a village, town or city gets its people
    // instead; see createCommoners).
    static readonly COURT_RETAINERS: [number, number] = [1, 3];
    static readonly COMMONER = 1;
    static readonly SLAVE = 0;

    static readonly MAX_NAME = 40;

    // game_ranks by rank, highest first, loaded once per request (see all()).
    private static ranks: Map<number, Rank> | null = null;

    /**
     * Every rank, highest first: Map of rank => {rank, name, female_name, is_noble, is_hereditary}.
     */
    static all(): Map<number, Rank> {
        if (Ranks.ranks === null) {
            Ranks.ranks = new Map();
            for (const row of Auth.db().all('SELECT * FROM game_ranks ORDER BY `rank` DESC')) {
                Ranks.ranks.set(int(row.rank), {
                    rank: int(row.rank), name: row.name, female_name: row.female_name,
                    is_noble: !!row.is_noble, is_hereditary: !!row.is_hereditary,
                });
            }
        }
        return Ranks.ranks;
    }

    /**
     * Drops the ranks loaded for this request (after they change underneath, as when a saved game is restored).
     */
    static forget(): void {
        Ranks.ranks = null;
    }

    /**
     * The titles (knight and up), highest first (a Map of rank => rank row).
     */
    static titles(): Map<number, Rank> {
        return new Map([...Ranks.all()].filter(([, r]) => r.rank >= Ranks.KNIGHT));
    }

    /**
     * Whether the rank is noble (peerage): players can't become an anthro of a noble rank.
     */
    static isNoble(rank: number): boolean {
        return Ranks.all().get(rank)?.is_noble ?? false;
    }

    /**
     * Whether the rank's title passes to its holder's heir (see successor).
     */
    static isHereditary(rank: number): boolean {
        return Ranks.all().get(rank)?.is_hereditary ?? false;
    }

    /**
     * An admin renames a rank's titles (male and female) and, for titles, sets whether it's noble and hereditary.
     * Commoners and slaves are neither. Returns an error message, or null.
     */
    static update(rank: number, name: string, femaleName: string, noble: boolean, hereditary: boolean): string | null {
        if (!Ranks.all().has(rank)) {
            return 'No such rank.';
        }
        name = trim(name);
        femaleName = trim(femaleName) === '' ? name : trim(femaleName);
        if (name === '' || mb_strlen(name) > Ranks.MAX_NAME || mb_strlen(femaleName) > Ranks.MAX_NAME) {
            return 'Give the rank a title of up to ' + Ranks.MAX_NAME + ' characters.';
        }
        for (const other of Ranks.all().values()) {
            const theirs = [other.name, other.female_name].map((n) => n.toLowerCase());
            if (other.rank !== rank && [name, femaleName].map((n) => n.toLowerCase()).some((n) => theirs.includes(n))) {
                return `${other.name} already uses that title.`;
            }
        }
        if (rank < Ranks.KNIGHT) {
            noble = hereditary = false;
        }
        Auth.db().run('UPDATE game_ranks SET name = ?, female_name = ?, is_noble = ?, is_hereditary = ? WHERE `rank` = ?',
            [name, femaleName, int(noble), int(hereditary), rank]);
        Ranks.ranks = null;
        return null;
    }

    /**
     * How many anthros hold each rank: Map of rank => count.
     */
    static counts(): Map<number, number> {
        const counts = Auth.db().pairs('SELECT ' + Ranks.sql('a') + ' AS r, COUNT(*) FROM game_anthros a GROUP BY r');
        const out = new Map<number, number>();
        for (const [rank, count] of counts) out.set(int(rank), int(count));
        for (const rank of Ranks.all().keys()) if (!out.has(rank)) out.set(rank, 0);
        return out;
    }

    /**
     * The anthros holding a title (knight and up), longest held first, each with its 'successor' (or null) if the
     * title is hereditary.
     */
    static holders(rank: number): Row[] {
        const ids = Auth.db().column('SELECT a.id FROM game_anthros a WHERE ' + Ranks.sql('a') + ' = ? ORDER BY a.title_since, a.id', [rank]);
        return ids.map((id) => {
            const anthro = Anthros.findAny(int(id))!;
            anthro.successor = rank >= Ranks.KNIGHT && Ranks.isHereditary(rank) ? Ranks.successor(anthro) : null;
            return anthro;
        });
    }

    // An anthro's rank in SQL, for the game_anthros alias given (see of()).
    static sql(alias: string): string {
        return 'CASE WHEN ' + Anthros.freeSql(alias) + ` THEN GREATEST(COALESCE(${alias}.title_rank, ` + Ranks.COMMONER + `),
                    COALESCE((SELECT hd.title_rank FROM game_anthros hd WHERE hd.id = ` + alias + '.spouse_of AND ' + Anthros.freeSql('hd') + `), 0))
                ELSE ` + Ranks.SLAVE + ' END';
    }

    /**
     * The anthro's rank: if it's free, its title (commoner without one) or, if higher, the title of the head of the
     * household it married into (see Marriages: it shares its spouse's rank as a consort); otherwise slave.
     */
    static of(anthro: Row): number {
        return Anthros.isFree(anthro)
            ? Math.max(int(anthro.title_rank ?? Ranks.COMMONER), int(anthro.consort_rank ?? 0))
            : Ranks.SLAVE;
    }

    /**
     * Whether the anthro's rank is its spouse's (see of), not its own title.
     */
    static isConsort(anthro: Row): boolean {
        return Anthros.isFree(anthro) && int(anthro.consort_rank ?? 0) > int(anthro.title_rank ?? Ranks.COMMONER);
    }

    static name(rank: number, presentsAs: string | null = null): string {
        const row = Ranks.all().get(rank) ?? null;
        return row === null ? `Rank ${rank}` : (presentsAs === 'female' ? row.female_name : row.name);
    }

    static title(anthro: Row): string {
        if (Anthros.isDead(anthro)) {
            return 'Deceased';
        }
        if (Anthros.isYoung(anthro)) {
            return 'Child';
        }
        return Ranks.name(Ranks.of(anthro), anthro.presents_as ?? null);
    }

    /**
     * Titled anthros (knight and up), highest rank first, those holding it by right before consorts (by_marriage:
     * the rank is their spouse's, spouse_of_name), then longest held, with their liege.
     */
    static titled(): Row[] {
        const rank = Ranks.sql('a');
        return Auth.db().all(
            `SELECT a.id, a.name, ge.presents_as, a.title_since, ${rank} AS \`rank\`, a.liege_id, l.name AS liege_name,
                    (SELECT COUNT(*) FROM game_anthros v WHERE v.liege_id = a.id) AS vassals,
                    COALESCE(a.title_rank, 0) < ${rank} AS by_marriage, a.spouse_of, hd.name AS spouse_of_name
             FROM game_anthros a
             JOIN game_genders ge ON ge.id = a.gender_id
             LEFT JOIN game_anthros l ON l.id = a.liege_id
             LEFT JOIN game_anthros hd ON hd.id = a.spouse_of
             WHERE ${rank} >= ` + Ranks.KNIGHT + `
             ORDER BY \`rank\` DESC, by_marriage, a.title_since, a.id`,
        );
    }

    /**
     * The court as a tree: {roots: nobles sworn to no noble (the crown first), each with 'children' (the nobles
     * sworn to it, the same way down), 'commoners' (how many free, untitled anthros are sworn to it) and
     * 'branchCommoners' (the same, for it and everyone below it) and 'owned' (anthros it owns, sworn to it), ranks:
     * Map of rank => how many hold it (highest first), sworn: commoners sworn to a noble, owned: owned anthros (sworn
     * to their owners), unsworn: free commoners sworn to nobody}.
     */
    static structure(): { roots: CourtNode[]; ranks: Map<number, number>; sworn: number; owned: number; unsworn: number } {
        const db = Auth.db();
        const free = Anthros.freeSql('a');
        const commoners: Map<number, number> = db.pairs(
            `SELECT a.liege_id, COUNT(*) FROM game_anthros a
             WHERE ${free} AND a.title_rank IS NULL AND a.liege_id IS NOT NULL GROUP BY a.liege_id`,
        );
        // Owned anthros are sworn to their owners.
        const owned: Map<number, number> = db.pairs(
            'SELECT owner_id, COUNT(*) FROM game_anthros WHERE owner_id IS NOT NULL AND owner_id <> id GROUP BY owner_id',
        );
        const nobles = new Map<number, CourtNode>();
        for (const noble of Ranks.titled()) {
            nobles.set(noble.id, {
                ...noble, commoners: int(commoners.get(noble.id) ?? 0), owned: int(owned.get(noble.id) ?? 0), children: [],
            });
        }
        // Each noble goes under its liege (who can be of the same rank: see maySwearTo), built down from the roots.
        const sworn = new Map<number, number[]>();
        for (const [id, noble] of nobles) {
            if (noble.liege_id !== null && nobles.has(noble.liege_id)) {
                if (!sworn.has(noble.liege_id)) sworn.set(noble.liege_id, []);
                sworn.get(noble.liege_id)!.push(id);
            }
        }
        const build = (id: number, above: Set<number>): CourtNode => {
            const node: CourtNode = { ...nobles.get(id)!, children: [] };
            for (const vassal of sworn.get(id) ?? []) {
                if (!above.has(vassal)) {
                    node.children.push(build(vassal, new Set([...above, id])));
                }
            }
            return node;
        };
        const roots: CourtNode[] = [];
        for (const [id, noble] of nobles) {
            if (noble.liege_id === null || !nobles.has(noble.liege_id)) {
                roots.push(Ranks.withBranchTotals(build(id, new Set())));
            }
        }
        const ranks = new Map<number, number>();
        for (const noble of nobles.values()) {
            const rank = int(noble.rank);
            ranks.set(rank, (ranks.get(rank) ?? 0) + 1);
        }
        return {
            roots,
            ranks: new Map([...ranks].sort(([a], [b]) => b - a)),
            sworn: array_sum(commoners.values()),
            owned: array_sum(owned.values()),
            unsworn: int(db.value(`SELECT COUNT(*) FROM game_anthros a WHERE ${free} AND a.title_rank IS NULL AND a.liege_id IS NULL`)),
        };
    }

    /**
     * The node with branchCommoners filled in, all the way down.
     */
    private static withBranchTotals(node: CourtNode): CourtNode {
        node.children = node.children.map(Ranks.withBranchTotals);
        node.branchCommoners = node.commoners + array_sum(array_column(node.children, 'branchCommoners'));
        return node;
    }

    /**
     * The anthros sworn to this one.
     */
    static vassals(anthroId: number): Row[] {
        return Auth.db().all(
            `SELECT a.id, a.name, a.title_rank, a.owner_id, a.young, ge.presents_as FROM game_anthros a JOIN game_genders ge ON ge.id = a.gender_id
             WHERE a.liege_id = ? ORDER BY a.title_rank DESC, a.name`,
            [anthroId],
        );
    }

    /**
     * The anthros sworn to this one, split into 'vassals' (free title holders), 'followers' (free commoners),
     * 'children' (young anthros it owns, which go free when they're grown) and 'slaves' (other anthros it owns, who
     * are sworn to it).
     */
    static sworn(anthroId: number): { vassals: Row[]; followers: Row[]; children: Row[]; slaves: Row[] } {
        const split: { vassals: Row[]; followers: Row[]; children: Row[]; slaves: Row[] } = { vassals: [], followers: [], children: [], slaves: [] };
        for (const anthro of Ranks.vassals(anthroId)) {
            let kind: keyof typeof split;
            if (anthro.young) {
                kind = 'children';
            } else if (anthro.owner_id !== anthro.id) {
                kind = 'slaves';
            } else if (anthro.title_rank !== null) {
                kind = 'vassals';
            } else {
                kind = 'followers';
            }
            split[kind].push(anthro);
        }
        return split;
    }

    /**
     * Whether the user can grant titles: admins, and the player of the King or Queen (titles below theirs).
     */
    static canGrant(user: User): boolean {
        return Auth.isAdmin(user) || Ranks.playsCrown(user);
    }

    /**
     * The ranks the user may grant, highest first.
     */
    static grantable(user: User): number[] {
        const top = Auth.isAdmin(user) ? Ranks.KING : (Ranks.playsCrown(user) ? Ranks.KING - 1 : 0);
        return top ? range(top, Ranks.KNIGHT) : [];
    }

    /**
     * Grants the anthro a title (rank knight or higher), or takes its title away (rank null).
     * Returns an error message, or null.
     */
    static grant(user: User, anthroId: number, rank: number | null): string | null {
        if (!Ranks.canGrant(user)) {
            return 'Only the crown can grant titles.';
        }
        if (rank !== null && !Ranks.grantable(user).includes(rank)) {
            return 'Choose a title you can grant.';
        }
        const anthro = Anthros.findAny(anthroId);
        if (!anthro) {
            return 'Choose an anthro.';
        }
        const isAdmin = Auth.isAdmin(user);
        if (!isAdmin && anthro.player_id === user.id) {
            return "You can't change your own title.";
        }
        if (!isAdmin && Ranks.of(anthro) >= Ranks.KING) {
            return 'Only an admin can change the King or Queen.';
        }
        if (rank !== null && !Anthros.isFree(anthro)) {
            return `${anthro.name} can't hold a title: only a free anthro can.`;
        }
        // There's one monarch by right (King or Queen, as it presents); its spouses share the crown as consorts.
        let monarch: Row | null;
        if (rank === Ranks.KING && (monarch = Ranks.monarch()) && monarch.id !== anthro.id) {
            return `${monarch.name} already wears the crown. Take that title away first.`;
        }
        if (rank === null && anthro.title_by_land && anthro.granted_rank !== null) {
            // It has risen above its granted title by land: revoking the grant takes away the floor, not the land's title.
            const granted = Ranks.name(int(anthro.granted_rank), anthro.presents_as);
            Auth.db().run('UPDATE game_anthros SET granted_rank = NULL WHERE id = ?', [anthro.id]);
            Notifications.toAnthro(anthro.id, `The crown revoked the title of ${granted} it granted you: you keep only what your land earns.`, '/game/court');
            Ranks.holdByLand();
            return null;
        }
        if (rank === (anthro.title_rank === null ? null : int(anthro.title_rank))) {
            return `${anthro.name} already has that rank.`;
        }
        Auth.db().run(
            'UPDATE game_anthros SET title_rank = ?, title_since = IF(? IS NULL, NULL, ' + Clock.sqlNow() + '), title_by_land = FALSE, granted_rank = NULL WHERE id = ?',
            [rank, rank, anthro.id],
        );
        // Those it outranked swore to it as their better: brought down to their rank (or below), they're released
        // (commoners are sworn to another lord: see assignLieges), not kept as a peer's.
        Auth.db().run('UPDATE game_anthros AS a SET liege_id = NULL WHERE a.liege_id = ? AND ' + Anthros.freeSql('a') + ' AND ' + Ranks.sql('a') + ' >= ?',
            [anthro.id, rank ?? Ranks.COMMONER]);
        Ranks.cleanLieges();
        Notifications.toAnthro(anthro.id, rank === null
            ? 'The crown took away your title; you are a commoner now.'
            : 'The crown made you ' + Ranks.name(rank, anthro.presents_as) + '.', '/game/court');
        return null;
    }

    /**
     * The acres a free anthro needs to hold to take up the rank (BARONET_ACRES for a baronet, ACRES_FACTOR times more for
     * each rank above, the crown included), or null for ranks that aren't taken up by land (knight and below).
     */
    static acresFor(rank: number): number | null {
        return rank >= Ranks.BARONET && rank <= Ranks.KING ? Ranks.BARONET_ACRES * Ranks.ACRES_FACTOR ** (rank - Ranks.BARONET) : null;
    }

    /**
     * The ids of everyone sworn to the anthro: its vassals, those sworn to them, and so on (not the anthro itself).
     */
    static fealtyOf(anthroId: number): number[] {
        const ids = Auth.db().column(
            `WITH RECURSIVE sworn (id, depth) AS (
                 SELECT id, 1 FROM game_anthros WHERE liege_id = ? AND died_at IS NULL
                 UNION ALL
                 SELECT a.id, s.depth + 1 FROM game_anthros a JOIN sworn s ON a.liege_id = s.id WHERE a.died_at IS NULL AND s.depth < 50
             )
             SELECT DISTINCT id FROM sworn WHERE id <> ?`,
            [anthroId, anthroId],
        );
        return ids.map(int);
    }

    /**
     * The anthro's realm: its household (the spouses who married into it: see Marriages) and everyone sworn to it, and
     * the households of, and everyone sworn to, each of those, and so on (not the anthro itself).
     */
    static realmOf(anthroId: number): number[] {
        const ids = Auth.db().column(
            `WITH RECURSIVE realm (id, depth) AS (
                 SELECT ?, 0
                 UNION ALL
                 SELECT a.id, r.depth + 1 FROM game_anthros a JOIN realm r ON a.liege_id = r.id OR a.spouse_of = r.id
                 WHERE a.died_at IS NULL AND r.depth < 50
             )
             SELECT DISTINCT id FROM realm WHERE id <> ?`,
            [anthroId, anthroId],
        );
        return ids.map(int);
    }

    /**
     * The land that counts toward the anthro's rank (see assumable): {own: its acres, sworn: the acres of its
     * realm (see realmOf: its household and everyone sworn to it), total: both}.
     */
    static acresHeld(anthro: Row): { own: number; sworn: number; total: number } {
        const sworn = Ranks.realmOf(anthro.id);
        let acres = 0.0;
        if (sworn.length) {
            acres = float(Auth.db().value(
                'SELECT COALESCE(SUM(acres), 0) FROM game_parcels WHERE anthro_id IN (' + sworn.map(() => '?').join(', ') + ')',
                sworn,
            ));
        }
        const own = Land.totalAcres(anthro.id);
        return { own, sworn: acres, total: own + acres };
    }

    /**
     * The next rank up that's taken up by land for the anthro (see acresFor): baronet for a commoner or knight, else
     * the one above its own. Null if there isn't one (above the crown).
     */
    static nextByLand(anthro: Row): number | null {
        const next = Math.max(Ranks.of(anthro) + 1, Ranks.BARONET);
        return Ranks.acresFor(next) === null ? null : next;
    }

    /**
     * The rank the anthro could take up now (see assume), or null. A free anthro takes up the highest rank above its
     * own that its land, with that of its household and everyone sworn to it (see acresHeld), earns (see acresFor).
     * Any number can hold each rank but the crown: there's one monarch by right (see monarch). A title taken up by land
     * is kept only while the land holds (see holdByLand).
     */
    static assumable(anthro: Row): number | null {
        if (!Anthros.isFree(anthro)) {
            return null;
        }
        const acres = Ranks.acresHeld(anthro).total;
        // A vassal holding a fief can't rise above its lord.
        const cap = anthro.liege_id !== null && Fiefs.holdsFief(anthro.id) ? Ranks.of(Anthros.findAny(int(anthro.liege_id))!) : Ranks.KING;
        let best: number | null = null;
        for (let next = Ranks.nextByLand(anthro); next !== null && next <= cap && Ranks.acresFor(next) !== null && acres >= Ranks.acresFor(next)!; next++) {
            if (next < Ranks.KING || Ranks.crownIsFree(anthro)) {
                best = next;
            }
        }
        return best;
    }

    /**
     * Whether nobody else wears the crown by right (see monarch).
     */
    private static crownIsFree(anthro: Row): boolean {
        const monarch = Ranks.monarch();
        return !monarch || monarch.id === anthro.id;
    }

    /**
     * The monarch: the one free anthro holding the crown by right (not as a consort), or null.
     */
    static monarch(): Row | null {
        const id = Auth.db().value('SELECT a.id FROM game_anthros a WHERE a.title_rank = ' + Ranks.KING + ' AND ' + Anthros.freeSql('a') + ' ORDER BY a.title_since, a.id LIMIT 1');
        return id === null ? null : Anthros.findAny(int(id));
    }

    /**
     * The player's anthro takes up the rank its land earns, or the crown (see assumable). A liege it no longer ranks
     * below lets it go. Returns an error message, or null.
     */
    static assume(user: User): string | null {
        const anthro = Anthros.player(user.id);
        if (!anthro) {
            return 'Create or become an anthro first.';
        }
        const next = Ranks.assumable(anthro);
        if (next === null) {
            const rank = Ranks.of(anthro);
            void rank;
            const byLand = Ranks.nextByLand(anthro);
            if (!Anthros.isFree(anthro)) {
                return 'Only a free anthro can take up a higher rank.';
            }
            if (byLand === Ranks.KING && Ranks.acresHeld(anthro).total >= Ranks.acresFor(Ranks.KING)!) {
                return 'Someone already wears the crown.';
            }
            if (byLand !== null) {
                return 'It takes ' + Land.acres(Ranks.acresFor(byLand)) + ' of land to become '
                    + Ranks.name(byLand, anthro.presents_as) + ' (with your household and those sworn to you, you hold '
                    + Land.acres(Ranks.acresHeld(anthro).total) + ').';
            }
            return 'There is no higher rank to take up.';
        }
        // A granted title it rises above stays as its floor (see holdByLand).
        Auth.db().run(
            `UPDATE game_anthros SET granted_rank = IF(title_by_land, granted_rank, title_rank), title_rank = ?, title_since = ` + Clock.sqlNow() + `,
                                     title_by_land = TRUE WHERE id = ?`,
            [next, anthro.id],
        );
        Ranks.cleanLieges();
        Notifications.toAdmins(`${anthro.name} took up the rank of ` + Ranks.name(next, anthro.presents_as) + '.', '/game/court');
        return null;
    }

    /**
     * The player's anthro swears to a liege of higher rank (liegeId), or renounces its liege (null).
     * Returns an error message, or null.
     */
    static swear(user: User, liegeId: number | null): string | null {
        const vassal = Anthros.player(user.id);
        if (!Land.canTrade(vassal)) {
            return 'Only an anthro that owns itself can swear to a liege.';
        }
        // (canTrade is false for no anthro.)
        const me = vassal!;
        if (liegeId === null) {
            if (me.liege_id === null) {
                return "You haven't sworn to a liege.";
            }
            if (Ranks.of(me) === Ranks.COMMONER) {
                return 'Commoners are always sworn to a noble. Choose another liege instead.';
            }
            Auth.db().run('UPDATE game_anthros SET liege_id = NULL WHERE id = ?', [me.id]);
            Notifications.toAnthro(me.liege_id, `${me.name} renounced you as their liege.`, '/game/court');
            // Their fiefs go back, and their land no longer counts toward the old liege's rank.
            Fiefs.reconcile();
            Ranks.holdByLand();
            return null;
        }
        const liege = Anthros.findAny(liegeId);
        if (!liege || liege.id === me.id || !Ranks.maySwearTo(me, liege)) {
            return 'Your liege must be of your rank or higher.';
        }
        if (Ranks.fealtyOf(me.id).includes(liege.id)) {
            return `${liege.name} is sworn to you.`;
        }
        if (me.liege_id === liege.id) {
            return `You're already sworn to ${liege.name}.`;
        }
        Auth.db().run('UPDATE game_anthros SET liege_id = ? WHERE id = ?', [liege.id, me.id]);
        Notifications.toAnthro(liege.id, `${me.name} swore fealty to you.`, '/game/court');
        // Fiefs held of the old lord go back to it.
        Fiefs.reconcile();
        Ranks.holdByLand();
        return null;
    }

    /**
     * Whether a free anthro can be sworn to the liege: the liege is of its rank or higher (and free: a slave's rank is
     * below any free anthro's).
     */
    static maySwearTo(vassal: Row, liege: Row): boolean {
        return Ranks.of(liege) >= Ranks.of(vassal);
    }

    /**
     * Called when an anthro loses its freedom or dies (why, for the heir's notification): it loses its title and
     * liege (and its vassals lose it as liege).
     * A hereditary title passes to its successor instead, with the liege and the free anthros sworn to it.
     * Returns the successor, or null.
     */
    static strip(anthro: Row, why = 'lost their freedom'): Row | null {
        const db = Auth.db();
        const rank = anthro.title_rank === null ? null : int(anthro.title_rank);
        const successor = rank !== null && Ranks.isHereditary(rank) ? Ranks.successor(anthro) : null;
        Baronies.passOn(anthro, successor);
        db.run('UPDATE game_anthros SET title_rank = NULL, title_since = NULL, title_by_land = FALSE, granted_rank = NULL, liege_id = NULL WHERE id = ?',
            [anthro.id]);
        Marriages.end(anthro, why);
        const dying = why === 'died';
        if (successor) {
            db.run('UPDATE game_anthros SET title_rank = ?, title_since = ' + Clock.sqlNow() + ', title_by_land = ?, granted_rank = ?, liege_id = ? WHERE id = ?',
                [rank, int(anthro.title_by_land ?? 0), anthro.granted_rank ?? null, anthro.liege_id, successor.id]);
            db.run(
                'UPDATE game_anthros SET liege_id = ? WHERE liege_id = ? AND id <> ? AND ' + Anthros.freeSql('game_anthros'),
                [successor.id, anthro.id, successor.id],
            );
            const title = Ranks.name(rank!, successor.presents_as);
            Notifications.toAnthro(successor.id, `${anthro.name} ${why}, and you inherited their title: you are ${title} now.`, '/game/court');
        }
        Fiefs.onLoss(anthro, successor, dying);
        Ranks.cleanLieges();
        return successor;
    }

    /**
     * Who would inherit the anthro's title: its eldest free child (by birthdate, then who was added first) that
     * doesn't already rank as high, skipping a child who would be a second King or Queen. Null if there's none.
     */
    static successor(anthro: Row): Row | null {
        const rank = anthro.title_rank === null ? null : int(anthro.title_rank);
        if (rank === null) {
            return null;
        }
        const ids = Auth.db().column(
            'SELECT a.id FROM game_anthros a WHERE (a.sire_id = ? OR a.dam_id = ?) AND a.id <> ? AND ' + Anthros.freeSql('a')
            + ' AND COALESCE(a.title_rank, 0) < ? ORDER BY a.birthdate IS NULL, a.birthdate, a.id',
            [anthro.id, anthro.id, anthro.id, rank],
        );
        for (const id of ids) {
            const child = Anthros.findAny(int(id));
            // One monarch by right: the crown passes only if the anthro wore it by right.
            let monarch: Row | null;
            if (rank === Ranks.KING && (monarch = Ranks.monarch()) && monarch.id !== anthro.id) {
                return null;
            }
            return child;
        }
        return null;
    }

    /**
     * Who receives the land of an anthro of rank forfeit to the crown: its liege if the liege is still of its rank or
     * higher,
     * otherwise whoever has held the next rank up the longest (skipping ranks no one holds), or null (the land
     * office) if no one outranks it.
     */
    static heir(anthro: Row, rank: number): Row | null {
        let liege: Row | null;
        if (anthro.liege_id !== null && (liege = Anthros.findAny(anthro.liege_id)) && Ranks.of(liege) >= rank) {
            return liege;
        }
        const rankSql = Ranks.sql('a');
        const id = Auth.db().value(
            `SELECT a.id FROM game_anthros a WHERE a.id <> ? AND ${rankSql} > ? ORDER BY ${rankSql}, a.title_since, a.id LIMIT 1`,
            [anthro.id, rank],
        );
        return id === null ? null : Anthros.findAny(int(id));
    }

    /**
     * The anthros holding the top rank: the King and the Queen.
     */
    static crown(): Row[] {
        const ids = Auth.db().column('SELECT a.id FROM game_anthros a WHERE ' + Ranks.sql('a') + ' = ' + Ranks.KING + ' ORDER BY a.id');
        return ids.map((id) => Anthros.findAny(int(id))!);
    }

    /**
     * Creates the realm's commoners, free and unplayed, each sworn to a lord: COURT_RETAINERS for each title holder,
     * except that a baronet managing part of a barony gets its people instead (Baronies::PEOPLE for its kind: a village,
     * town or city's worth, none for an expanse). Random gender, species and name (avoiding names already in use while
     * there are fresh ones), grown (see Anthros::randomAdultBirthdate). Returns how many it created.
     */
    static createCommoners(): number {
        const db = Auth.db();
        const lords: number[] = array_column(Ranks.titled(), 'id');
        const parts: Map<number, string> = db.pairs('SELECT manager_anthro_id, kind FROM game_barony_parts WHERE manager_anthro_id IS NOT NULL');
        const lieges: (number | null)[] = [];
        for (const lordId of lords) {
            const range: readonly [number, number] | number[] = parts.has(lordId) ? Baronies.PEOPLE[parts.get(lordId)!] : Ranks.COURT_RETAINERS;
            lieges.push(...array_fill(random_int(range[0], range[1]), lordId));
        }
        return Ranks.insertCommoners(lieges);
    }

    // The fewest free commoners a new game starts with, and the most an admin can ask for (see fillCommoners).
    static readonly MIN_COMMONERS = 100;
    static readonly MAX_COMMONERS = 10000;

    /**
     * Makes up the free commoners (untitled, unplayed, living) to want (at least MIN_COMMONERS), or as many as there are
     * occupations if that's more, so every trade can be someone's (see Schedules::spreadTrades); the new ones are sworn
     * to no one yet (see assignLieges). Returns how many it created.
     */
    static fillCommoners(want: number = Ranks.MIN_COMMONERS): number {
        const have = int(Auth.db().value(
            'SELECT COUNT(*) FROM game_anthros a WHERE a.title_rank IS NULL AND a.player_id IS NULL AND ' + Anthros.freeSql('a'),
        ));
        want = Math.max(Ranks.MIN_COMMONERS, want, Schedules.occupations().size);
        return have >= want ? 0 : Ranks.insertCommoners(array_fill(want - have, null));
    }

    /**
     * Creates free, unplayed commoners, one for each entry of lieges (the lord each is sworn to, or null): random
     * gender, species and name (see createCommoners). Returns how many it created.
     */
    private static insertCommoners(lieges: (number | null)[]): number {
        const db = Auth.db();
        const species: number[] = db.column('SELECT id FROM game_species');
        if (!lieges.length || !species.length) {
            return 0;
        }
        // Name pools by presentation (see Names), as shuffled queues of names not in use yet.
        const used = new Set<string>(db.column('SELECT name FROM game_anthros'));
        const pools: Record<string, { all: string[]; fresh: string[] }> = {};
        for (const [presents, where] of Object.entries({ male: 'is_male', female: 'is_female', androgynous: 'is_male AND is_female' })) {
            let names: string[] = db.column(`SELECT name FROM game_names WHERE ${where}`);
            if (!names.length) names = ['Nameless'];
            shuffle(names);
            pools[presents] = { all: names, fresh: names.filter((n) => !used.has(n)) };
        }
        // Genders by birth weight, as Genders::randomBirthId picks them (evenly if no gender has a weight).
        const genders = Genders.all();
        let weights = genders.map((g) => int(g.birth_weight));
        if (!array_sum(weights)) {
            weights = genders.map(() => 1);
        }
        const rows: unknown[][] = [];
        for (const lordId of lieges) {
            let roll = random_int(1, array_sum(weights));
            let index = 0;
            for (; index < weights.length; index++) {
                if ((roll -= weights[index]) <= 0) {
                    break;
                }
            }
            const pool = pools[genders[index].presents_as];
            const name = pool.fresh.length ? pool.fresh.pop()! : pool.all[array_rand(pool.all)];
            const birthdate = Anthros.randomAdultBirthdate();
            rows.push([name, genders[index].id, species[array_rand(species)], birthdate, Anthros.randomFertileOn(birthdate), lordId]);
        }
        for (const chunk of array_chunk(rows, 500)) {
            db.run(
                'INSERT INTO game_anthros (name, gender_id, species_id, birthdate, fertile_on, liege_id) VALUES '
                + chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', '),
                chunk.flat(),
            );
        }
        Anthros.freeUnowned();
        return rows.length;
    }

    /**
     * Creates a full court of free, unplayed anthros: a King and his Queen consort, COURT_VASSALS dukes sworn to the
     * King, COURT_VASSALS marquesses sworn to each duke, and so on down to knights. Returns how many anthros it created.
     */
    static createCourt(): number {
        const counts = new Map<number, number>();
        for (let rank = Ranks.KING; rank >= Ranks.KNIGHT; rank--) {
            counts.set(rank, Ranks.COURT_VASSALS ** (Ranks.KING - rank));
        }
        return Ranks.createRanks(counts);
    }

    /**
     * Creates free, unplayed title holders, granted their titles: counts = Map of rank => how many, King (at most 1: the
     * monarch, with a Queen consort if consort) down to knight. Each is sworn to one of the nearest rank above that
     * has anyone, spread evenly (none if there's no one above). Returns how many anthros it created.
     */
    static createRanks(counts: Map<number, number>, consort = true): number {
        const db = Auth.db();
        const species: number[] = db.column('SELECT id FROM game_species');
        if (!species.length) {
            return 0;
        }
        const insert = `INSERT INTO game_anthros (name, gender_id, species_id, birthdate, fertile_on, title_rank, title_since, liege_id)
             VALUES (?, ?, ?, ?, ?, ?, ` + Clock.sqlNow() + `, ?)`;
        const create = (rank: number | null, liegeId: number | null, genderId: number | null = null): number => {
            genderId ??= Genders.randomBirthId();
            const birthdate = Anthros.randomAdultBirthdate();
            db.run(insert, [
                Names.random(0, Genders.find(genderId)!.presents_as), genderId, species[array_rand(species)],
                birthdate, Anthros.randomFertileOn(birthdate), rank, liegeId,
            ]);
            const id = db.lastInsertId();
            Anthros.free(id);
            return id;
        };
        let created = 0;
        let above: number[] = [];
        for (let rank = Ranks.KING; rank >= Ranks.KNIGHT; rank--) {
            const count = rank === Ranks.KING ? Math.min(1, int(counts.get(rank) ?? 0)) : Math.max(0, int(counts.get(rank) ?? 0));
            const ids: number[] = [];
            for (let i = 0; i < count; i++) {
                ids.push(create(rank, above.length ? above[i % above.length] : null, rank === Ranks.KING ? Ranks.genderPresenting('male') : null));
            }
            if (rank === Ranks.KING && ids.length && consort) {
                // The Queen is his consort: the crown is his by right, and hers by marriage (see Marriages).
                db.run('UPDATE game_anthros SET title_since = NULL, spouse_of = ? WHERE id = ?',
                    [ids[0], create(null, null, Ranks.genderPresenting('female'))]);
                created++;
            }
            created += ids.length;
            above = ids.length ? ids : above;
        }
        return created;
    }

    /**
     * The most common gender that presents this way (e.g. Male for the King), or a random one if none does.
     */
    private static genderPresenting(presentsAs: string): number {
        const id = Auth.db().value('SELECT id FROM game_genders WHERE presents_as = ? ORDER BY birth_weight DESC, sort_order LIMIT 1', [presentsAs]);
        return int(id || Genders.randomBirthId());
    }

    /**
     * Whether the user plays the King or the Queen (the monarch, or a consort).
     */
    static playsCrown(user: User): boolean {
        for (const holder of Ranks.crown()) {
            if (holder.player_id === user.id) {
                return true;
            }
        }
        return false;
    }

    /**
     * Drops liege links that no longer hold: the vassal isn't free, or doesn't rank below its liege.
     */
    private static cleanLieges(): void {
        // Free anthros only: an owned one is sworn to its owner whatever their ranks (see assignLieges). A peer can be
        // sworn to a peer (see maySwearTo).
        Auth.db().run(
            `UPDATE game_anthros AS v SET liege_id = NULL FROM game_anthros l
             WHERE l.id = v.liege_id AND ` + Anthros.freeSql('v') + ' AND ' + Ranks.sql('v') + ' > ' + Ranks.sql('l'),
        );
        // A vassal released gives back its fiefs.
        Fiefs.reconcile();
    }

    /**
     * Titles taken up by land are kept only while the land holds: any whose holder's land (with its realm's: see
     * acresHeld) no longer earns it falls to the highest rank the land does earn, but not below a title the crown
     * granted it (granted_rank; commoner if none), and its holder is told.
     * A fall can release vassals who now outrank it, costing their lieges land in turn, so it repeats until nothing
     * falls. The game runs this each day, and when a marriage ends or fealty changes. Returns how many titles fell.
     */
    static holdByLand(): number {
        const db = Auth.db();
        let fell = 0;
        for (let round = 0; round < 20; round++) {
            let changed = 0;
            const ids = db.column('SELECT a.id FROM game_anthros a WHERE a.title_by_land AND a.title_rank IS NOT NULL AND ' + Anthros.freeSql('a'));
            for (const id of ids) {
                const anthro = Anthros.findAny(int(id))!;
                const rank = int(anthro.title_rank);
                const acres = Ranks.acresHeld(anthro).total;
                const granted = anthro.granted_rank === null ? null : int(anthro.granted_rank);
                let kept = granted;
                for (let r = Math.max(Ranks.BARONET, (granted ?? 0) + 1); r <= rank; r++) {
                    if (acres >= Ranks.acresFor(r)!) {
                        kept = r;
                    }
                }
                if (kept === rank) {
                    continue;
                }
                // Back to its granted title, that's what it holds again (by grant, not land).
                const byLand = kept !== null && kept !== granted;
                db.run('UPDATE game_anthros SET title_rank = ?, title_by_land = ?, granted_rank = ? WHERE id = ?',
                    [kept, int(byLand), byLand ? granted : null, id]);
                const was = Ranks.name(rank, anthro.presents_as);
                Notifications.toAnthro(int(id), `Without the land for it, you are no longer ${was}: you are `
                    + Ranks.name(kept ?? Ranks.COMMONER, anthro.presents_as) + ' now.', '/game/court');
                changed++;
            }
            if (!changed) {
                break;
            }
            fell += changed;
            Ranks.cleanLieges();
        }
        return fell;
    }

    /**
     * Makes sure everyone is sworn to someone: an owned anthro to its owner, the game's to no one, and a free
     * commoner (no title) to a noble: one of the lowest rank held, whoever has the fewest sworn commoners, so they
     * spread evenly. Commoners already sworn to someone of their rank or higher keep their liege; a newly sworn one that's
     * played is told. The game runs this on each request. Returns how many commoners were given a liege.
     */
    static assignLieges(): number {
        const db = Auth.db();
        db.run(
            `UPDATE game_anthros SET liege_id = owner_id
             WHERE (owner_id IS NULL OR owner_id <> id) AND NOT (liege_id IS owner_id)`,
        );
        Ranks.cleanLieges();
        const free = Anthros.freeSql('a');
        const unsworn = db.column(
            `SELECT a.id FROM game_anthros a WHERE ${free} AND a.title_rank IS NULL AND a.liege_id IS NULL AND ` + Ranks.sql('a') + ' = ' + Ranks.COMMONER + ' ORDER BY a.id',
        );
        if (!unsworn.length) {
            return 0;
        }
        const rank = Ranks.sql('a');
        const lowest = db.value(`SELECT MIN(${rank}) FROM game_anthros a WHERE ${rank} >= ` + Ranks.KNIGHT);
        if (!lowest) {
            return 0;
        }
        // [noble id => commoners sworn], fewest first as each commoner is placed.
        const load: Map<number, number> = db.pairs(
            `SELECT a.id, (SELECT COUNT(*) FROM game_anthros c WHERE c.liege_id = a.id AND c.title_rank IS NULL AND c.owner_id = c.id)
             FROM game_anthros a WHERE ${rank} = ` + int(lowest) + ' ORDER BY a.id',
        );
        for (const id of unsworn) {
            const least = Math.min(...load.values());
            const liege = [...load].find(([, n]) => n === least)![0];
            db.run('UPDATE game_anthros SET liege_id = ? WHERE id = ?', [liege, id]);
            load.set(liege, load.get(liege)! + 1);
            const vassal = Anthros.findAny(int(id))!;
            if (vassal.player_id !== null) {
                const noble = Anthros.findAny(int(liege))!;
                Notifications.toAnthro(vassal.id, 'You are sworn to ' + Ranks.title(noble) + ` ${noble.name}.`, '/game/court');
            }
        }
        return unsworn.length;
    }
}

onReset(() => {
    Ranks.forget();
});
