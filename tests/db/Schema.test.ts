// Upstream: tests/Game/SchemaTest.php. Upstream tests its migrations (Game\Schema::migrate) against MariaDB; here the
// schema is generated (tools/convert-schema.mjs) and the triggers hand-written (src/db/triggers.sql), so what's tested
// is how a database opens and how the triggers behave.
import initSqlJs from 'sql.js';
import { describe, expect, test } from 'vitest';
import { Auth } from '../../src/core/Auth';
import { setRandom } from '../../src/core/random';
import { migrate, openDatabase } from '../../src/db/open';
import { anthro, coins, db, genderId, player, playerAnthro, refresh, scalar, setCoins } from '../TestCase';

const count = (sql: string, params: unknown[] = []) => Number(scalar(sql, params));

/** Inserts a bare anthro, as the triggers see it; returns its row. */
function insert(fields: Record<string, unknown>): Record<string, any> {
    const columns = Object.keys(fields);
    db().run(`INSERT INTO game_anthros (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, Object.values(fields));
    return db().row('SELECT * FROM game_anthros WHERE id = ?', [db().lastInsertId()])!;
}

describe('Schema', () => {
    // Upstream: testMigrateIsRepeatableAndKeepsData runs Schema::migrate again on the test database. Here: migrating
    // an up-to-date database, and reopening a saved one, keep the data.
    test('migrate is repeatable and keeps data', async () => {
        const alice = player('alice');
        const a = playerAnthro(alice);
        setCoins(a.id, 42);

        migrate(db());
        expect(coins(a.id)).toBe(42);

        const reopened = openDatabase(await initSqlJs(), db().export());
        Auth.setDb(reopened);
        expect(coins(a.id)).toBe(42);
        expect(count('SELECT COUNT(*) FROM game_names')).toBe(600);
        expect(count('SELECT COUNT(*) FROM game_species')).toBe(37);
        expect(count('SELECT COUNT(*) FROM game_genders')).toBe(5);
    });

    test('fertile weekday trigger fills new anthros', () => {
        db().run(`INSERT INTO game_anthros (name, gender_id) VALUES ('Fresh', ${genderId('Female')})`);
        const day = count("SELECT fertile_weekday FROM game_anthros WHERE name = 'Fresh'");
        expect(day).toBeGreaterThanOrEqual(1);
        expect(day).toBeLessThanOrEqual(7);
        db().run(`INSERT INTO game_anthros (name, gender_id, fertile_weekday) VALUES ('Given', ${genderId('Female')}, 3)`);
        expect(count("SELECT fertile_weekday FROM game_anthros WHERE name = 'Given'")).toBe(3);
    });

    test('starting coins trigger skips anthros that have a wallet', () => {
        db().run('PRAGMA foreign_keys = OFF');
        db().run('INSERT INTO game_wallets (anthro_id, balance) VALUES (5000, 777)');
        db().run(`INSERT INTO game_anthros (id, name, gender_id) VALUES (5000, 'Restored', ${genderId('Male')})`);
        db().run('PRAGMA foreign_keys = ON');
        expect(coins(5000)).toBe(777);
        expect(count('SELECT COUNT(*) FROM game_ledger WHERE anthro_id = 5000')).toBe(0);
    });

    test('deleting a user never deletes anthros', () => {
        const alice = player('alice');
        const bob = player('bobby');
        let own = playerAnthro(alice);
        const owned = anthro({ owner: alice });
        let bobsAnthro = playerAnthro(bob, { owner: alice });
        const before = count('SELECT COUNT(*) FROM game_anthros');
        Auth.delete(alice.id);
        expect(count('SELECT COUNT(*) FROM game_anthros')).toBe(before);
        own = refresh(own);
        expect(own.player_id).toBeNull(); // Just unplayed.
        expect(own.owner_id).toBe(own.id); // Still free.
        expect(refresh(owned).owner_id).toBe(own.id); // It still owns its anthros.
        bobsAnthro = refresh(bobsAnthro);
        expect(bobsAnthro.player_id).toBe(bob.id); // Bob still plays his anthro.
        expect(bobsAnthro.owner_id).toBe(own.id);
    });

    // Upstream's testOwnershipMovesFromUsersToAnthros isn't ported: it rebuilds the layout of an old MariaDB schema
    // (owners were users) and runs that migration, which is history this port's schema starts after.

    // Not upstream: the rest of the triggers.

    test('starting coins and food', () => {
        setRandom(() => 0.5);
        const a = insert({ name: 'Newborn', gender_id: genderId('Male') });
        expect(coins(a.id)).toBe(50);
        expect(db().all('SELECT amount, balance_after, reason FROM game_ledger WHERE anthro_id = ?', [a.id]))
            .toEqual([{ amount: 50, balance_after: 50, reason: 'Starting balance' }]);
        expect(count("SELECT quantity FROM game_goods WHERE anthro_id = ? AND good = 'food'", [a.id])).toBe(7);

        setRandom(() => 0.999999);
        expect(coins(insert({ name: 'Lucky', gender_id: genderId('Male') }).id)).toBe(100);
        setRandom(() => 0);
        expect(coins(insert({ name: 'Unlucky', gender_id: genderId('Male') }).id)).toBe(0);
    });

    test('starting food is not added twice', () => {
        db().run('PRAGMA foreign_keys = OFF');
        db().run("INSERT INTO game_goods (anthro_id, good, quantity) VALUES (6000, 'food', 3)");
        db().run(`INSERT INTO game_anthros (id, name, gender_id) VALUES (6000, 'Stocked', ${genderId('Male')})`);
        db().run('PRAGMA foreign_keys = ON');
        expect(count("SELECT quantity FROM game_goods WHERE anthro_id = 6000 AND good = 'food'")).toBe(3);
    });

    test('max cubs are random without a mother', () => {
        setRandom(() => 0);
        expect(insert({ name: 'A', gender_id: genderId('Female') }).max_cubs).toBe(1);
        setRandom(() => 0.999999);
        expect(insert({ name: 'B', gender_id: genderId('Female') }).max_cubs).toBe(8);
        setRandom(null);
        expect(insert({ name: 'C', gender_id: genderId('Female'), max_cubs: 5 }).max_cubs).toBe(5);
        // A dam_id that names nobody counts as no mother.
        db().run('PRAGMA foreign_keys = OFF');
        setRandom(() => 0.5);
        expect(insert({ name: 'D', gender_id: genderId('Female'), dam_id: 999999 }).max_cubs).toBe(5);
        db().run('PRAGMA foreign_keys = ON');
    });

    test('max cubs come from the mother give or take one', () => {
        const mother = insert({ name: 'Mother', gender_id: genderId('Female'), max_cubs: 4 });
        setRandom(() => 0);
        expect(insert({ name: 'Less', gender_id: genderId('Female'), dam_id: mother.id }).max_cubs).toBe(3);
        setRandom(() => 0.5);
        expect(insert({ name: 'Same', gender_id: genderId('Female'), dam_id: mother.id }).max_cubs).toBe(4);
        setRandom(() => 0.999999);
        expect(insert({ name: 'More', gender_id: genderId('Female'), dam_id: mother.id }).max_cubs).toBe(5);

        // Kept to 1 to 8.
        const big = insert({ name: 'Big', gender_id: genderId('Female'), max_cubs: 8 });
        expect(insert({ name: 'Bigger', gender_id: genderId('Female'), dam_id: big.id }).max_cubs).toBe(8);
        const small = insert({ name: 'Small', gender_id: genderId('Female'), max_cubs: 1 });
        setRandom(() => 0);
        expect(insert({ name: 'Smaller', gender_id: genderId('Female'), dam_id: small.id }).max_cubs).toBe(1);
    });

    test('fertile until and lifespan', () => {
        const days = (a: Record<string, any>) => count('SELECT DATEDIFF(?, ?)', [a.fertile_until, a.birthdate]);
        setRandom(() => 0);
        let a = insert({ name: 'Early', gender_id: genderId('Male'), birthdate: '2026-01-01' });
        expect(days(a)).toBe(329); // 47 weeks
        expect(a.lifespan_weeks).toBe(52);
        setRandom(() => 0.999999);
        a = insert({ name: 'Late', gender_id: genderId('Male'), birthdate: '2026-01-01' });
        expect(days(a)).toBe(364); // 52 weeks
        expect(a.lifespan_weeks).toBe(80);

        // A dam lives at least 20 weeks past her fertile years: (364 + 140) / 7 = 72 weeks.
        setRandom(() => 0.999999);
        const dam = insert({ name: 'Dam', gender_id: genderId('Female'), birthdate: '2026-01-01', fertile_until: '2026-12-31', lifespan_weeks: null });
        expect(days(dam)).toBe(364);
        setRandom(() => 0);
        const shortDam = insert({ name: 'ShortDam', gender_id: genderId('Female'), birthdate: '2026-01-01', fertile_until: '2026-12-31' });
        expect(shortDam.lifespan_weeks).toBe(72);
        // ...but a sire needn't.
        const sire = insert({ name: 'Sire', gender_id: genderId('Male'), birthdate: '2026-01-01', fertile_until: '2026-12-31' });
        expect(sire.lifespan_weeks).toBe(52);

        // Given values are kept; no birthdate, no fertile_until.
        a = insert({ name: 'Given', gender_id: genderId('Male'), birthdate: '2026-01-01', fertile_until: '2026-06-01', lifespan_weeks: 60 });
        expect([a.fertile_until, a.lifespan_weeks]).toEqual(['2026-06-01', 60]);
        a = insert({ name: 'Unborn', gender_id: genderId('Male') });
        expect(a.fertile_until).toBeNull();
        expect(a.lifespan_weeks).toBe(52);
    });
});
