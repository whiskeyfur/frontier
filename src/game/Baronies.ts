// Upstream: game/src/Baronies.php
import { Auth } from '../core/Auth';
import { array_chunk, array_fill, array_rand, array_sum, int, mb_strlen, pick, random_int, round, trim } from '../core/php';
import type { Db, Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Clock } from './Clock';
import { Genders } from './Genders';
import { Names } from './Names';
import { Notifications } from './Notifications';
import { Ranks } from './Ranks';

/** Where an anthro lives: [barony id, part id or null]. */
export type Residence = [number, number | null];

/**
 * Baronies: where land lies. Every lot lies in a barony, and maybe in one of its parts (a village, a town, a city, or
 * an expanse being developed); who owns it is separate (see Land). A barony is held and managed by a baron,
 * or directly by a higher lord (the King's own castle lies in a barony he holds himself). Every lord above the holder
 * in the fealty chain holds it indirectly: a duke through his marquesses, and on down. Each part is managed by a
 * baronet. Holdings follow titles: a hereditary title's successor takes them over; otherwise a barony goes up to the
 * holder's liege, and a part back to its barony's holder.
 *
 * Where an anthro lives follows its fealty (see residenceOf): the part managed by, or the barony held by, the nearest
 * lord up its fealty chain (owned anthros are sworn to their owners, so they live with them). A reset settles each
 * baronet's part with its people (PEOPLE) and lays out its land (layOut): a village's commoners farm VILLAGER_ACRES
 * each, around a core held by its baronet; a town is one lot of TOWN_ACRES held by its baronet, and a city one such
 * lot for every CITY_PEOPLE_PER_LOT people.
 */
export class Baronies {
    // The lowest rank that can hold a barony (baron) and manage a part of one (baronet).
    static readonly HOLDER_RANK = 4;
    // The least rank that manages any part (see managerRank: towns and cities want more).
    static readonly MANAGER_RANK = 2; // Ranks.KNIGHT
    static readonly KINDS: Record<string, string> = { village: 'Village', manor: 'Manor', town: 'Town', city: 'City', expanse: 'Expanse' };
    // Who manages each kind of part, at least: a knight a village, manor or expanse; a baronet or higher a town or city.
    // (2 is Ranks.KNIGHT.)
    static readonly MANAGER_RANKS: Record<string, number> = { village: 2, manor: 2, expanse: 2, town: 3, city: 3 };
    // Kinds settled like a village: a core for its lord, and a lot for each commoner living there (see layOut).
    static readonly VILLAGE_KINDS = ['village', 'manor'];
    static readonly MAX_NAME = 64;
    // How a reset picks the kind of each baronet's part (by weight), and how many people it settles in it.
    // How a reset picks the kind of part a lord manages, by its rank (see createForCourt). (2 is Ranks.KNIGHT.)
    private static readonly KIND_WEIGHTS: Record<number, Record<string, number>> = {
        2: { village: 60, manor: 25, expanse: 15 },
        3: { town: 80, city: 20 },
    };
    static readonly PEOPLE: Record<string, [number, number]> = { village: [50, 300], manor: [20, 80], town: [150, 400], city: [400, 1000], expanse: [0, 0] };
    // Land: a village commoner's lot (10 acres for them and each of the young they're raising), the village's core
    // held by its baronet, and the lots a town (one) or a city (one per CITY_PEOPLE_PER_LOT people) is built on.
    static readonly VILLAGER_ACRES = 10;
    static readonly VILLAGE_CORE_ACRES: [number, number] = [10, 50];
    static readonly TOWN_ACRES: [number, number] = [40, 50];
    static readonly CITY_PEOPLE_PER_LOT = 300;
    // The realm a reset founds (see foundRealm): one barony, with a baronet for each of these parts.
    static readonly REALM_PARTS: Record<string, number> = { town: 1, village: 5, expanse: 2 };
    // The barony a reset always leaves, with no one in it (see foundEmpty): its parts, its acres in all, and how they
    // divide (the rest is the barony's own land, in no part).
    static readonly EMPTY_PARTS: Record<string, number> = { village: 3, town: 1, expanse: 1 };
    static readonly EMPTY_ACRES: [number, number] = [10000, 15000];
    private static readonly EMPTY_SHARES: Record<string, number> = { village: 0.15, town: 0.1, expanse: 0.35 };

    // Place names are a PREFIX and a SUFFIX: Ashford, Wolfholm, Brambury...
    private static readonly PREFIXES = [
        'Ash', 'Oak', 'Elm', 'Wolf', 'Fox', 'Hare', 'Stag', 'Raven', 'Wren', 'Thorn', 'Bram', 'Heath', 'Mill', 'Stone',
        'Black', 'White', 'Red', 'Green', 'Cold', 'Frost', 'Moss', 'Fern', 'Brook', 'Marsh', 'Hollow', 'High', 'Low',
        'Kings', 'Bright', 'Amber', 'Otter', 'Badger', 'Lynx', 'Bear', 'Hawk', 'Willow', 'Birch', 'Hazel', 'Iron', 'Salt',
    ];
    private static readonly SUFFIXES = [
        'ford', 'wick', 'dale', 'holm', 'mere', 'stead', 'field', 'bury', 'ton', 'ham', 'worth', 'moor', 'crest',
        'vale', 'wood', 'by', 'gate', 'well', 'hurst', 'combe',
    ];

    /**
     * A place name not in taken (compared case-insensitively), e.g. "Ashford".
     */
    static placeName(taken: string[]): string {
        const takenSet = new Set(taken.map((t) => String(t).toLowerCase()));
        for (let attempt = 0; attempt < 500; attempt++) {
            const name = Baronies.PREFIXES[array_rand(Baronies.PREFIXES)] + Baronies.SUFFIXES[array_rand(Baronies.SUFFIXES)];
            if (!takenSet.has(name.toLowerCase())) {
                return name;
            }
        }
        return 'Place ' + (takenSet.size + 1);
    }

    /**
     * Seats the court's baronies: one held by the crown (the King's own), one for each baron, and in each a part for
     * every lord below a baron in its baron's service (see randomKind): a town or city for each baronet, and a village,
     * manor or expanse for each knight. Those in no baron's service get parts of the crown's barony. Returns how many
     * baronies it made.
     */
    static createForCourt(db: Db | null = null): number {
        db ??= Auth.db();
        const free = Anthros.freeSql('a');
        const titled = db.all(
            `SELECT a.id, a.title_rank, a.liege_id FROM game_anthros a WHERE ${free} AND a.title_rank IS NOT NULL
             ORDER BY a.title_rank DESC, a.id`,
        );
        if (!titled.length) {
            return 0;
        }
        const names: string[] = db.column('SELECT name FROM game_baronies');
        const insert = 'INSERT INTO game_baronies (name, holder_anthro_id) VALUES (?, ?)';
        const baronyOf = new Map<number, number>();
        let crown: number | null = null;
        for (const anthro of titled) {
            const isCrown: boolean = int(anthro.title_rank) === Ranks.KING && crown === null;
            if (isCrown || int(anthro.title_rank) === Baronies.HOLDER_RANK) {
                const name = Baronies.placeName(names);
                names.push(name);
                db.run(insert, [name, anthro.id]);
                baronyOf.set(anthro.id, db.lastInsertId());
                crown ??= isCrown ? baronyOf.get(anthro.id)! : null;
            }
        }
        const part = 'INSERT INTO game_barony_parts (barony_id, name, kind, manager_anthro_id) VALUES (?, ?, ?, ?)';
        const partNames = new Map<number, string[]>();
        const lieges = new Map<number, number | null>(titled.map((a) => [a.id, a.liege_id]));
        for (const anthro of titled) {
            const rank = int(anthro.title_rank);
            if (rank < Baronies.MANAGER_RANK || rank >= Baronies.HOLDER_RANK) {
                continue;
            }
            // Its barony: that of the first lord above it who holds one (a knight's baronet's baron), else the crown's.
            let baronyId: number | null = null;
            for (let liege: number | null = anthro.liege_id, hops = 0; liege !== null && baronyId === null && hops < 20; liege = lieges.get(liege) ?? null, hops++) {
                baronyId = baronyOf.get(liege) ?? null;
            }
            baronyId ??= crown;
            if (baronyId === null) {
                continue;
            }
            if (!partNames.has(baronyId)) partNames.set(baronyId, []);
            const name = Baronies.placeName([...names, ...partNames.get(baronyId)!]);
            partNames.get(baronyId)!.push(name);
            db.run(part, [baronyId, name, Baronies.randomKind(rank), anthro.id]);
        }
        return baronyOf.size;
    }

    /**
     * Founds a small realm (a reset's): a Baron, played by playerId (an admin; nobody if null), holding one barony,
     * with a baronet sworn to him managing each of its REALM_PARTS. There are no higher lords yet: land earns the
     * ranks above (see Ranks::assume). Returns [the baron's id, how many title
     * holders it made].
     */
    static foundRealm(playerId: number | null): [number | null, number] {
        const db = Auth.db();
        const species: number[] = db.column('SELECT id FROM game_species');
        if (!species.length) {
            return [null, 0];
        }
        const insert = `INSERT INTO game_anthros (name, gender_id, species_id, birthdate, fertile_on, title_rank, title_since, liege_id, player_id)
             VALUES (?, ?, ?, ?, ?, ?, ` + Clock.sqlNow() + `, ?, ?)`;
        const names: string[] = [];
        const lord = (rank: number, liegeId: number | null, playerId: number | null = null): number => {
            const genderId = Genders.randomBirthId();
            const birthdate = Anthros.randomAdultBirthdate();
            db.run(insert, [
                Names.random(0, Genders.find(genderId)!.presents_as), genderId, pick(species),
                birthdate, Anthros.randomFertileOn(birthdate), rank, liegeId, playerId,
            ]);
            const id = db.lastInsertId();
            Anthros.free(id);
            return id;
        };
        const baron = lord(Baronies.HOLDER_RANK, null, playerId);
        let name = Baronies.placeName(names);
        names.push(name);
        db.run('INSERT INTO game_baronies (name, holder_anthro_id) VALUES (?, ?)', [name, baron]);
        const baronyId = db.lastInsertId();
        const part = 'INSERT INTO game_barony_parts (barony_id, name, kind, manager_anthro_id) VALUES (?, ?, ?, ?)';
        let made = 1;
        for (const [kind, count] of Object.entries(Baronies.REALM_PARTS)) {
            for (let i = 0; i < count; i++) {
                name = Baronies.placeName(names);
                names.push(name);
                db.run(part, [baronyId, name, kind, lord(Baronies.managerRank(kind), baron)]);
                made++;
            }
        }
        return [baron, made];
    }

    // Settlements a new game asks for (see addSettlements), and the land office's land that comes with each, in acres.
    static readonly SETTLEMENT_KINDS = ['village', 'town', 'city'];
    static readonly SETTLEMENT_ACRES: Record<string, [number, number]> = { village: [1500, 2250], town: [1000, 1500], city: [2000, 3000] };

    /**
     * Makes up the villages, towns and cities to at least wanted ({kind: how many}): those there are count (a court's,
     * or the empty barony's), and the rest are founded, nobody managing them yet, spread over the baronies in turn, each
     * with a lot of the land office's (SETTLEMENT_ACRES). Returns how many it founded.
     */
    static addSettlements(wanted: Record<string, number>, db: Db | null = null): number {
        db ??= Auth.db();
        const baronies: number[] = db.column('SELECT id FROM game_baronies ORDER BY id');
        if (!baronies.length) {
            return 0;
        }
        const have: Map<string, number> = db.pairs('SELECT kind, COUNT(*) FROM game_barony_parts GROUP BY kind');
        const names: string[] = db.column('SELECT name FROM game_baronies UNION SELECT name FROM game_barony_parts');
        const part = 'INSERT INTO game_barony_parts (barony_id, name, kind, manager_anthro_id) VALUES (?, ?, ?, NULL)';
        const lot = 'INSERT INTO game_parcels (anthro_id, acres, barony_id, part_id) VALUES (NULL, ?, ?, ?)';
        let founded = 0;
        for (const kind of Baronies.SETTLEMENT_KINDS) {
            for (let i = int(have.get(kind) ?? 0); i < int(wanted[kind] ?? 0); i++) {
                const baronyId = int(baronies[founded % baronies.length]);
                const name = Baronies.placeName(names);
                names.push(name);
                db.run(part, [baronyId, name, kind]);
                db.run(lot, [random_int(...Baronies.SETTLEMENT_ACRES[kind]), baronyId, db.lastInsertId()]);
                founded++;
            }
        }
        return founded;
    }

    /**
     * Founds a barony nobody holds, with EMPTY_PARTS nobody manages, and EMPTY_ACRES of land in all, all the land
     * office's: a lot in each part (by EMPTY_SHARES) and the rest the barony's own. Returns [its id, its acres].
     */
    static foundEmpty(db: Db | null = null): [number, number] {
        db ??= Auth.db();
        const names: string[] = db.column('SELECT name FROM game_baronies UNION SELECT name FROM game_barony_parts');
        const name = Baronies.placeName(names);
        names.push(name);
        db.run('INSERT INTO game_baronies (name, holder_anthro_id) VALUES (?, NULL)', [name]);
        const baronyId = db.lastInsertId();
        const total = random_int(Baronies.EMPTY_ACRES[0], Baronies.EMPTY_ACRES[1]);
        const part = 'INSERT INTO game_barony_parts (barony_id, name, kind, manager_anthro_id) VALUES (?, ?, ?, NULL)';
        const lot = 'INSERT INTO game_parcels (anthro_id, acres, barony_id, part_id) VALUES (NULL, ?, ?, ?)';
        let left = total;
        for (const [kind, count] of Object.entries(Baronies.EMPTY_PARTS)) {
            for (let i = 0; i < count; i++) {
                const partName = Baronies.placeName(names);
                names.push(partName);
                db.run(part, [baronyId, partName, kind]);
                const acres = int(round(total * Baronies.EMPTY_SHARES[kind]));
                db.run(lot, [acres, baronyId, db.lastInsertId()]);
                left -= acres;
            }
        }
        db.run(lot, [left, baronyId, null]);
        return [baronyId, total];
    }

    /**
     * The least rank that can manage a part of this kind (see MANAGER_RANKS).
     */
    static managerRank(kind: string): number {
        return Object.hasOwn(Baronies.MANAGER_RANKS, kind) ? Baronies.MANAGER_RANKS[kind] : 3;
    }

    /**
     * A kind of part for a lord of rank to manage, picked by KIND_WEIGHTS: a knight's village, manor or expanse; a
     * baronet's town or city.
     */
    private static randomKind(rank: number): string {
        const weights = Baronies.KIND_WEIGHTS[rank >= 3 ? 3 : Ranks.KNIGHT];
        let roll = random_int(1, array_sum(Object.values(weights)));
        for (const [kind, weight] of Object.entries(weights)) {
            if ((roll -= weight) <= 0) {
                return kind;
            }
        }
        return Object.keys(weights)[0];
    }

    /**
     * Lays out the land of every part that has none yet, for the people living there (see residences): in a village,
     * its baronet's core (VILLAGE_CORE_ACRES) and a lot for each free commoner living there, VILLAGER_ACRES for them
     * and as much again for each of the young they're raising; a town's one lot (TOWN_ACRES) and a city's one per
     * CITY_PEOPLE_PER_LOT people (at least one), held by the baronet. Returns how many lots it made.
     */
    static layOut(db: Db | null = null): number {
        db ??= Auth.db();
        const done = new Set<number>(db.column('SELECT DISTINCT part_id FROM game_parcels WHERE part_id IS NOT NULL'));
        const parts = db.all('SELECT id, barony_id, kind, manager_anthro_id FROM game_barony_parts ORDER BY id')
            .filter((part) => !done.has(part.id));
        if (!parts.length) {
            return 0;
        }
        const residents = new Map<number, number[]>();
        for (const [anthroId, [, partId]] of Baronies.residences(db)) {
            if (partId !== null) {
                if (!residents.has(partId)) residents.set(partId, []);
                residents.get(partId)!.push(anthroId);
            }
        }
        const free = Anthros.freeSql('a');
        const commoners = new Set<number>(db.column(`SELECT a.id FROM game_anthros a WHERE ${free} AND a.title_rank IS NULL`));
        // The young a free mother is raising: her own young ones.
        const young = db.pairs(
            'SELECT owner_id, COUNT(*) FROM game_anthros WHERE young AND owner_id = dam_id AND died_at IS NULL GROUP BY owner_id',
        );
        const lots: [number, number, Row][] = [];
        const acres = (range: [number, number]) => random_int(range[0] * 100, range[1] * 100) / 100;
        for (const part of parts) {
            const people = residents.get(part.id) ?? [];
            const manager: number | null = part.manager_anthro_id;
            if (Baronies.VILLAGE_KINDS.includes(part.kind)) {
                if (manager !== null) {
                    lots.push([manager, acres(Baronies.VILLAGE_CORE_ACRES), part]);
                }
                for (const id of people) {
                    if (commoners.has(id)) {
                        lots.push([id, Baronies.VILLAGER_ACRES * (1 + int(young.get(id) ?? 0)), part]);
                    }
                }
            } else if (manager !== null && ['town', 'city'].includes(part.kind)) {
                const count = part.kind === 'town' ? 1 : Math.max(1, int(Math.ceil(people.length / Baronies.CITY_PEOPLE_PER_LOT)));
                for (let i = 0; i < count; i++) {
                    lots.push([manager, acres(Baronies.TOWN_ACRES), part]);
                }
            }
        }
        for (const chunk of array_chunk(lots, 500)) {
            db.run(
                'INSERT INTO game_parcels (anthro_id, acres, barony_id, part_id) VALUES ' + array_fill(chunk.length, '(?, ?, ?, ?)').join(', '),
                chunk.flatMap((lot) => [lot[0], lot[1], lot[2].barony_id, lot[2].id]),
            );
        }
        return lots.length;
    }

    /**
     * Where every living anthro lives: Map(anthro id => [barony id, part id or null]), following fealty (see
     * residenceOf). Anthros sworn to no holding live nowhere (and aren't listed).
     */
    static residences(db: Db | null = null): Map<number, Residence> {
        db ??= Auth.db();
        const lieges = db.pairs('SELECT id, liege_id FROM game_anthros WHERE died_at IS NULL') as Map<number, number | null>;
        const manages = new Map<number, Residence>();
        for (const row of db.all('SELECT manager_anthro_id, barony_id, id FROM game_barony_parts WHERE manager_anthro_id IS NOT NULL ORDER BY id DESC')) {
            manages.set(row.manager_anthro_id, [int(row.barony_id), int(row.id)]);
        }
        const holds = new Map<number, Residence>();
        for (const row of db.all('SELECT holder_anthro_id, id FROM game_baronies WHERE holder_anthro_id IS NOT NULL ORDER BY id DESC')) {
            holds.set(row.holder_anthro_id, [int(row.id), null]);
        }
        const where = new Map<number, Residence | null>();
        const resolve = (id: number): Residence | null => {
            if (where.has(id)) {
                return where.get(id)!;
            }
            where.set(id, null); // (guards against a loop in the chain)
            const liege = lieges.get(id) ?? null;
            const found = manages.get(id) ?? holds.get(id) ?? (liege === null ? null : resolve(int(liege)));
            where.set(id, found);
            return found;
        };
        for (const id of lieges.keys()) {
            resolve(int(id));
        }
        const residences = new Map<number, Residence>();
        for (const [id, home] of where) {
            if (lieges.has(id) && home) {
                residences.set(id, home);
            }
        }
        return residences;
    }

    /**
     * The lot a free commoner farms in the village it lives in (its largest there), or null: it isn't a free
     * commoner, doesn't live in a village, or holds no land there.
     */
    static villageLotOf(anthroId: number): Row | null {
        const anthro = Anthros.findAny(anthroId);
        const home = anthro && Anthros.isFree(anthro) && anthro.title_rank === null ? Baronies.residenceOf(anthroId) : null;
        if (!home || !Baronies.VILLAGE_KINDS.includes(home.part_kind)) {
            return null;
        }
        return Auth.db().row('SELECT * FROM game_parcels WHERE anthro_id = ? AND part_id = ? ORDER BY acres DESC, id LIMIT 1',
            [anthroId, home.part_id]);
    }

    /**
     * Where the anthro lives: {barony_id, barony_name, part_id, part_name, part_kind} (the part is null for
     * one living in a barony but in no part of it), or null if it lives nowhere. It lives in the part its nearest
     * lord up the fealty chain (or itself) manages, or the barony they hold.
     */
    static residenceOf(anthroId: number): Row | null {
        const where = Baronies.whereSworn(anthroId, Auth.db());
        if (where === null) {
            return null;
        }
        return Auth.db().row(
            `SELECT b.id AS barony_id, b.name AS barony_name, p.id AS part_id, p.name AS part_name, p.kind AS part_kind
             FROM game_baronies b LEFT JOIN game_barony_parts p ON p.id = ? WHERE b.id = ?`,
            [where[1], where[0]],
        );
    }

    /**
     * Puts every parcel that lies in no barony into one: an anthro's land goes where it's sworn (the part or barony
     * it or the nearest lord above it manages or holds); the land office's is spread evenly over the baronies, half
     * of it in their parts. Returns how many parcels it placed.
     */
    static placeParcels(db: Db | null = null): number {
        db ??= Auth.db();
        const baronies: number[] = db.column('SELECT id FROM game_baronies ORDER BY id');
        if (!baronies.length) {
            return 0;
        }
        const parts = new Map<number, number[]>();
        for (const row of db.all('SELECT id, barony_id FROM game_barony_parts ORDER BY id')) {
            if (!parts.has(row.barony_id)) parts.set(row.barony_id, []);
            parts.get(row.barony_id)!.push(int(row.id));
        }
        const parcels = db.all('SELECT id, anthro_id FROM game_parcels WHERE barony_id IS NULL ORDER BY id');
        const place = 'UPDATE game_parcels SET barony_id = ?, part_id = ? WHERE id = ?';
        let next = 0;
        for (const parcel of parcels) {
            let where = parcel.anthro_id === null ? null : Baronies.whereSworn(int(parcel.anthro_id), db);
            if (where === null) {
                const baronyId = int(baronies[next++ % baronies.length]);
                const inBarony = parts.get(baronyId) ?? [];
                const partId = inBarony.length && random_int(0, 1) ? pick(inBarony) : null;
                where = [baronyId, partId];
            }
            db.run(place, [where[0], where[1], parcel.id]);
        }
        return parcels.length;
    }

    /**
     * [barony id, part id or null] for the nearest holding up the anthro's fealty chain, starting with its own: a
     * part it manages, or a barony it holds. Null if there's none.
     */
    private static whereSworn(anthroId: number, db: Db): Residence | null {
        const manages = 'SELECT barony_id, id FROM game_barony_parts WHERE manager_anthro_id = ? ORDER BY id LIMIT 1';
        const holds = 'SELECT id FROM game_baronies WHERE holder_anthro_id = ? ORDER BY id LIMIT 1';
        const liege = 'SELECT liege_id FROM game_anthros WHERE id = ?';
        const seen = new Set<number>();
        for (let id: number | null = anthroId; id !== null && !seen.has(id);) {
            seen.add(id);
            const row = db.row(manages, [id]);
            if (row) {
                return [int(row.barony_id), int(row.id)];
            }
            const baronyId = db.value(holds, [id]);
            if (baronyId) {
                return [int(baronyId), null];
            }
            const next = db.value(liege, [id]);
            id = next ? int(next) : null;
        }
        return null;
    }

    /**
     * Every barony, by name: its holder (id, name, title), its land (acres in all; office, the land office's; and
     * parcels, how many lots), and its parts (each with its manager and acres). With people, how many people live
     * in each (people; for a barony, everyone living anywhere in it). A Map(barony id => barony), in name order.
     */
    static all(people = false): Map<number, Row> {
        const db = Auth.db();
        // barony id => part id (0: none) => its land
        const land = new Map<number, Map<number, { acres: number; office: number; parcels: number }>>();
        for (const row of db.all(
            `SELECT barony_id, part_id, SUM(acres) AS acres, SUM(IF(anthro_id IS NULL, acres, 0)) AS office, COUNT(*) AS parcels
             FROM game_parcels WHERE barony_id IS NOT NULL GROUP BY barony_id, part_id`,
        )) {
            if (!land.has(row.barony_id)) land.set(row.barony_id, new Map());
            land.get(row.barony_id)!.set(row.part_id ?? 0, { acres: Number(row.acres), office: Number(row.office), parcels: int(row.parcels) });
        }
        const living = { parts: new Map<number, number>(), baronies: new Map<number, number>() };
        if (people) {
            for (const [baronyId, partId] of Baronies.residences().values()) {
                living.baronies.set(baronyId, (living.baronies.get(baronyId) ?? 0) + 1);
                if (partId !== null) {
                    living.parts.set(partId, (living.parts.get(partId) ?? 0) + 1);
                }
            }
        }
        const parts = new Map<number, Row[]>();
        for (const part of db.all(
            `SELECT p.*, m.name AS manager_name FROM game_barony_parts p LEFT JOIN game_anthros m ON m.id = p.manager_anthro_id
             ORDER BY p.name, p.id`,
        )) {
            part.acres = land.get(part.barony_id)?.get(part.id)?.acres ?? 0.0;
            part.people = living.parts.get(part.id) ?? 0;
            part.manager = part.manager_anthro_id === null ? null : Anthros.findAny(int(part.manager_anthro_id));
            if (!parts.has(part.barony_id)) parts.set(part.barony_id, []);
            parts.get(part.barony_id)!.push(part);
        }
        const baronies = new Map<number, Row>();
        for (const barony of db.all('SELECT * FROM game_baronies ORDER BY name, id')) {
            const sums = [...(land.get(barony.id)?.values() ?? [])];
            barony.acres = array_sum(sums.map((s) => s.acres));
            barony.office = array_sum(sums.map((s) => s.office));
            barony.parcels = array_sum(sums.map((s) => s.parcels));
            barony.holder = barony.holder_anthro_id === null ? null : Anthros.findAny(int(barony.holder_anthro_id));
            barony.parts = parts.get(barony.id) ?? [];
            barony.people = living.baronies.get(barony.id) ?? 0;
            baronies.set(barony.id, barony);
        }
        return baronies;
    }

    /**
     * One barony (as in all()), with its parcels (owner and any open listing) and the lords it's held through,
     * or null.
     */
    static find(id: number): Row | null {
        const barony = Baronies.all(true).get(id) ?? null;
        if (!barony) {
            return null;
        }
        barony.parcels_list = Auth.db().all(
            `SELECT p.*, a.name AS owner_name, pt.name AS part_name, l.id AS listing_id, l.price
             FROM game_parcels p
             LEFT JOIN game_anthros a ON a.id = p.anthro_id
             LEFT JOIN game_barony_parts pt ON pt.id = p.part_id
             LEFT JOIN game_land_listings l ON l.parcel_id = p.id AND l.status = 'open'
             WHERE p.barony_id = ? ORDER BY pt.name IS NOT NULL, pt.name, p.acres DESC, p.id`,
            [id],
        );
        barony.through = barony.holder ? Baronies.lordsAbove(barony.holder.id) : [];
        return barony;
    }

    /**
     * The lords above the anthro in its fealty chain, nearest first (who hold its baronies indirectly).
     */
    static lordsAbove(anthroId: number): Row[] {
        const lords: Row[] = [];
        const seen = new Set<number>([anthroId]);
        let anthro = Anthros.findAny(anthroId);
        while (anthro && anthro.liege_id !== null && !seen.has(anthro.liege_id)) {
            seen.add(anthro.liege_id);
            anthro = Anthros.findAny(int(anthro.liege_id));
            if (anthro) {
                lords.push(anthro);
            }
        }
        return lords;
    }

    /**
     * The realm's baronies as a tree of lords: {roots: lords sworn to no lord (the crown first), each with its
     * baronies (held directly), children (the lords below it with baronies in their branch) and branch (how
     * many baronies and acres it holds, directly or through them); unheld: baronies nobody holds}.
     */
    static tree(): { roots: Row[]; unheld: Row[] } {
        const baronies = Baronies.all(true);
        const byHolder = new Map<number, Row[]>();
        const unheld: Row[] = [];
        for (const barony of baronies.values()) {
            if (barony.holder_anthro_id === null) {
                unheld.push(barony);
            } else {
                if (!byHolder.has(barony.holder_anthro_id)) byHolder.set(barony.holder_anthro_id, []);
                byHolder.get(barony.holder_anthro_id)!.push(barony);
            }
        }
        const lords = new Map<number, Row>();
        for (const lord of Ranks.titled()) {
            lords.set(lord.id, { baronies: byHolder.get(lord.id) ?? [], children: [], ...lord });
        }
        // Lowest first, so each lord is complete before it's copied up to its liege.
        for (const id of [...lords.keys()].reverse()) {
            const liege = lords.get(id)!.liege_id;
            if (liege !== null && lords.has(liege)) {
                // (A copy, as PHP's arrays are.)
                const lord = lords.get(id)!;
                lords.get(liege)!.children.unshift({ ...lord, children: [...lord.children] });
            }
        }
        const roots: Row[] = [];
        for (const lord of lords.values()) {
            if (lord.liege_id === null || !lords.has(lord.liege_id)) {
                const node = Baronies.pruned(lord);
                if (node) {
                    roots.push(node);
                }
            }
        }
        return { roots, unheld };
    }

    /**
     * The lord's node with branch totals, keeping only children with baronies in their branch; null if it has none.
     * (It returns a new node, leaving the one given as it was, as upstream's copy of the array does.)
     */
    private static pruned(given: Row): Row | null {
        const lord: Row = { ...given };
        lord.children = (given.children as Row[]).map(Baronies.pruned).filter((c): c is Row => c !== null);
        lord.branch = {
            baronies: lord.baronies.length + array_sum(lord.children.map((c: Row) => c.branch.baronies)),
            acres: array_sum(lord.baronies.map((b: Row) => b.acres)) + array_sum(lord.children.map((c: Row) => c.branch.acres)),
        };
        return lord.branch.baronies ? lord : null;
    }

    /**
     * The anthro's holdings: held (baronies it holds directly), through (baronies held by lords sworn below it,
     * each with via, the lord just below it they're held through) and managed (parts it manages, with their
     * barony's name).
     */
    static holdingsOf(anthroId: number): { held: Row[]; through: Row[]; managed: Row[] } {
        const held: Row[] = [];
        const through: Row[] = [];
        for (const barony of Baronies.all(true).values()) {
            if (barony.holder_anthro_id === null) {
                continue;
            }
            if (barony.holder_anthro_id === anthroId) {
                held.push(barony);
                continue;
            }
            const chain = [barony.holder, ...Baronies.lordsAbove(barony.holder_anthro_id)];
            for (const [i, lord] of chain.entries()) {
                if (i > 0 && lord.id === anthroId) {
                    through.push({ via: chain[i - 1], ...barony });
                    break;
                }
            }
        }
        const managed = Auth.db().all(
            `SELECT p.*, b.name AS barony_name FROM game_barony_parts p JOIN game_baronies b ON b.id = p.barony_id
             WHERE p.manager_anthro_id = ? ORDER BY b.name, p.name`,
            [anthroId],
        );
        return { held, through, managed };
    }

    /**
     * Whether the anthro may hold a barony (free, alive, baron or higher) or, with rank MANAGER_RANK, manage a part.
     */
    static qualifies(anthro: Row | null, rank: number = Baronies.HOLDER_RANK): boolean {
        return anthro !== null && Anthros.isFree(anthro) && Ranks.of(anthro) >= rank;
    }

    /**
     * Admin: a new barony, held by holderId (null: nobody yet). Returns [id, null] or [null, error message].
     */
    static create(name: string, holderId: number | null): [number | null, string | null] {
        name = trim(name);
        const error = Baronies.validateName(name) ?? Baronies.validateHolder(holderId);
        if (error) {
            return [null, error];
        }
        Auth.db().run('INSERT INTO game_baronies (name, holder_anthro_id) VALUES (?, ?)', [name, holderId]);
        const id = Auth.db().lastInsertId();
        Baronies.tellHolder(holderId, name);
        return [id, null];
    }

    /**
     * Admin: renames a barony and sets who holds it. Returns an error message, or null.
     */
    static update(id: number, name: string, holderId: number | null): string | null {
        const barony = Baronies.all().get(id) ?? null;
        name = trim(name);
        if (!barony) {
            return 'No such barony.';
        }
        const error = Baronies.validateName(name, id) ?? Baronies.validateHolder(holderId);
        if (error) {
            return error;
        }
        Auth.db().run('UPDATE game_baronies SET name = ?, holder_anthro_id = ? WHERE id = ?', [name, holderId, id]);
        if (holderId !== barony.holder_anthro_id) {
            Baronies.tellHolder(holderId, name);
            if (barony.holder_anthro_id !== null) {
                Notifications.toAnthro(barony.holder_anthro_id, `The crown gave the barony of ${name} to another lord.`, '/game/court/lands/' + id);
            }
        }
        return null;
    }

    /**
     * Admin: removes a barony that no land lies in. Returns an error message, or null.
     */
    static delete(id: number): string | null {
        const barony = Baronies.all().get(id) ?? null;
        if (!barony) {
            return 'No such barony.';
        }
        if (barony.parcels) {
            return `Land lies in ${barony.name}: move its lots to another barony first.`;
        }
        Auth.db().run('DELETE FROM game_baronies WHERE id = ?', [id]);
        return null;
    }

    /**
     * Admin: a new part of a barony (or, with partId, changes one): its name, kind and manager (null: its barony's
     * holder manages it). Returns an error message, or null.
     */
    static savePart(baronyId: number, partId: number | null, name: string, kind: string, managerId: number | null): string | null {
        const barony = Baronies.all().get(baronyId) ?? null;
        name = trim(name);
        if (!barony) {
            return 'No such barony.';
        }
        if (partId !== null && !barony.parts.map((p: Row) => int(p.id)).includes(partId)) {
            return 'That isn\'t part of ' + barony.name + '.';
        }
        if (name === '' || mb_strlen(name) > Baronies.MAX_NAME) {
            return 'Name it (up to ' + Baronies.MAX_NAME + ' characters).';
        }
        for (const other of barony.parts as Row[]) {
            if (other.id !== partId && other.name.toLowerCase() === name.toLowerCase()) {
                return `${barony.name} already has a part called ${other.name}.`;
            }
        }
        if (!Object.hasOwn(Baronies.KINDS, kind)) {
            return 'Choose a village, a manor, a town, a city or an expanse.';
        }
        if (managerId !== null && !Baronies.qualifies(Anthros.findAny(managerId), Baronies.managerRank(kind))) {
            const article = kind === 'expanse' ? 'an' : 'a';
            return 'Only a free ' + Ranks.name(Baronies.managerRank(kind)) + ` or higher can manage ${article} ` + Baronies.KINDS[kind].toLowerCase() + '.';
        }
        const db = Auth.db();
        let before: number | null = null;
        if (partId === null) {
            db.run('INSERT INTO game_barony_parts (barony_id, name, kind, manager_anthro_id) VALUES (?, ?, ?, ?)',
                [baronyId, name, kind, managerId]);
            partId = db.lastInsertId();
        } else {
            before = (barony.parts as Row[]).find((p) => p.id === partId)!.manager_anthro_id;
            db.run('UPDATE game_barony_parts SET name = ?, kind = ?, manager_anthro_id = ? WHERE id = ?',
                [name, kind, managerId, partId]);
        }
        if (managerId !== null && managerId !== before) {
            Notifications.toAnthro(managerId, 'You manage ' + Baronies.KINDS[kind].toLowerCase() + ` ${name} in the barony of ${barony.name} now.`, '/game/court/lands/' + baronyId);
        }
        return null;
    }

    /**
     * Admin: removes a part of a barony; its land stays in the barony. Returns an error message, or null.
     */
    static deletePart(partId: number): string | null {
        return Auth.db().run('DELETE FROM game_barony_parts WHERE id = ?', [partId]) ? null : 'No such part.';
    }

    /**
     * Admin: moves a parcel to another barony (and part of it, or none). Returns an error message, or null.
     */
    static moveParcel(parcelId: number, baronyId: number, partId: number | null): string | null {
        const barony = Baronies.all().get(baronyId) ?? null;
        if (!barony) {
            return 'Choose a barony.';
        }
        if (partId !== null && !barony.parts.map((p: Row) => int(p.id)).includes(partId)) {
            return `Choose a part of ${barony.name}, or none.`;
        }
        if (!Auth.db().value('SELECT COUNT(*) FROM game_parcels WHERE id = ?', [parcelId])) {
            return 'No such lot.';
        }
        Auth.db().run('UPDATE game_parcels SET barony_id = ?, part_id = ? WHERE id = ?', [baronyId, partId, parcelId]);
        return null;
    }

    /**
     * Called as an anthro loses its title (see Ranks::strip): what it holds goes to its successor, if its title passes
     * on; otherwise its baronies go up to its liege (if the liege can hold them; else nobody) and its parts back to
     * their baronies' holders.
     */
    static passOn(anthro: Row, successor: Row | null): void {
        const db = Auth.db();
        const liege = anthro.liege_id === null ? null : Anthros.findAny(int(anthro.liege_id));
        const to = successor ?? (Baronies.qualifies(liege) ? liege : null);
        db.run('UPDATE game_baronies SET holder_anthro_id = ? WHERE holder_anthro_id = ?', [to?.id ?? null, anthro.id]);
        db.run('UPDATE game_barony_parts SET manager_anthro_id = ? WHERE manager_anthro_id = ?',
            [successor?.id ?? null, anthro.id]);
    }

    /**
     * Makes holdings follow titles: a holder that can no longer hold a barony (it lost its freedom, died, or was made
     * less than a baron) passes it up to its liege, or to nobody; a manager no longer a baronet or higher lets its
     * part go. The game runs this on each request. Returns how many holdings changed hands.
     */
    static settle(): number {
        const db = Auth.db();
        const rank = 'CASE WHEN ' + Anthros.freeSql('a') + ' THEN COALESCE(a.title_rank, ' + Ranks.COMMONER + ') ELSE ' + Ranks.SLAVE + ' END';
        const rankL = rank.replaceAll('a.', 'l.');
        let changed = db.run(
            `UPDATE game_baronies AS b SET holder_anthro_id = IF(l.id IS NOT NULL AND ${rankL} >= ` + Baronies.HOLDER_RANK + `, l.id, NULL)
             FROM game_anthros a LEFT JOIN game_anthros l ON l.id = a.liege_id
             WHERE a.id = b.holder_anthro_id AND ` + rank + ' < ' + Baronies.HOLDER_RANK,
        );
        // A manager below the rank its part needs (see managerRank) lets it go.
        const needs = 'CASE p.kind ' + Object.entries(Baronies.MANAGER_RANKS).map(([kind, r]) => `WHEN '${kind}' THEN ` + int(r)).join(' ')
            + ' ELSE ' + Baronies.HOLDER_RANK + ' END';
        changed += db.run(
            `UPDATE game_barony_parts AS p SET manager_anthro_id = NULL FROM game_anthros a
             WHERE a.id = p.manager_anthro_id AND ${rank} < ${needs}`,
        );
        return changed;
    }

    private static validateName(name: string, id: number | null = null): string | null {
        if (name === '' || mb_strlen(name) > Baronies.MAX_NAME) {
            return 'Name the barony (up to ' + Baronies.MAX_NAME + ' characters).';
        }
        return Auth.db().value('SELECT COUNT(*) FROM game_baronies WHERE name = ? AND id <> ?', [name, id ?? 0])
            ? `There's already a barony called ${name}.` : null;
    }

    private static validateHolder(holderId: number | null): string | null {
        if (holderId !== null && !Baronies.qualifies(Anthros.findAny(holderId))) {
            return 'Only a free ' + Ranks.name(Baronies.HOLDER_RANK) + ' or higher can hold a barony.';
        }
        return null;
    }

    private static tellHolder(holderId: number | null, name: string): void {
        if (holderId !== null) {
            Notifications.toAnthro(holderId, `The crown granted you the barony of ${name}.`, '/game/court/lands');
        }
    }
}
