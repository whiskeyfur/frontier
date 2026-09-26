// Upstream: tests/Game/SavesTest.php
import { describe, expect, test } from 'vitest';
import { Auth } from '../../src/core/Auth';
import { Anthros } from '../../src/game/Anthros';
import { Board } from '../../src/game/Board';
import { Saves } from '../../src/game/Saves';
import { admin, anthro, coins, db, notificationsForUser, player, playerAnthro, refresh, scalar, setCoins } from '../TestCase';

// Upstream stores gzencode(...) of the JSON; here it's the JSON's bytes.
const bytes = (text: string) => new TextEncoder().encode(text);

describe('Saves', () => {
    test('create find all and json', () => {
        const boss = admin();
        anthro({ name: 'Saved' });
        expect(Saves.create(boss, ' ')).toEqual([null, 'Name the save (up to 100 characters).']);
        const [id, error] = Saves.create(boss, ' First ');
        expect(error).toBeNull();
        const save = Saves.find(id!)!;
        expect(save.name).toBe('First');
        expect(save.anthros).toBe(1);
        const snapshot = JSON.parse(Saves.json(save));
        expect(snapshot.tables.game_anthros.map((a: any) => a.name)).toEqual(['Saved']);
        expect(snapshot.tables.game_names).toHaveLength(600);
        expect(snapshot.tables).toHaveProperty('game_species');
        const list = Saves.all();
        expect(list[0].created_by_name).toBe('boss');
        expect(list[0]).not.toHaveProperty('data');
        expect(Saves.find(999999)).toBeNull();
    });

    test('delete', () => {
        const [id] = Saves.create(admin(), 'Gone');
        expect(Saves.delete(id!)).toBeNull();
        expect(Saves.delete(id!)).toBe('That save no longer exists.');
    });

    test('restore brings the game back exactly', () => {
        const boss = admin();
        const alice = player('alice');
        const a = playerAnthro(alice, { name: 'Fenn' });
        setCoins(a.id, 123);
        const child = anthro({ name: 'Cub', sire_id: a.id });
        const [id] = Saves.create(boss, 'Checkpoint');
        const ledger = Number(scalar('SELECT COUNT(*) FROM game_ledger'));

        Board.reset(boss, Board.CONFIRM_WORD);
        expect(Saves.restore(boss, id!)).toBeNull();

        expect(coins(a.id)).toBe(123);
        expect(Anthros.player(alice.id)!.player_id).toBe(alice.id);
        expect(refresh(child).sire_id).toBe(a.id);
        expect(Number(scalar('SELECT COUNT(*) FROM game_ledger'))).toBe(ledger); // No starting balances added on restore.
        // The game as it was is saved first.
        expect(Saves.all().map((s) => s.name)).toEqual(['Before restoring "Checkpoint"', 'Checkpoint']);
        const before = JSON.parse(Saves.json(Saves.find(Number(Saves.all()[0].id))!));
        expect(before.tables.game_anthros).toEqual([]); // That was the empty game after the reset.
        expect(notificationsForUser(boss.id)[0].startsWith('boss restored the saved game "Checkpoint"')).toBe(true);
    });

    test('restore clears accounts deleted since the save', () => {
        const boss = admin();
        const alice = player('alice');
        const a = playerAnthro(alice);
        const pet = anthro({ owner: alice });
        const [id] = Saves.create(boss, 'With alice');
        Auth.delete(alice.id);
        expect(Saves.restore(boss, id!)).toBeNull();
        const restored = refresh(a);
        expect(restored.player_id).toBeNull(); // Unplayed: its player is gone.
        expect(restored.owner_id).toBe(restored.id);
        expect(refresh(pet).owner_id).toBe(a.id); // Anthros own anthros, so that's unchanged.
    });

    test('restore leaves tables an older save doesnt have', () => {
        const boss = admin();
        const [id] = Saves.create(boss, 'Old');
        const snapshot = JSON.parse(Saves.json(Saves.find(id!)!));
        delete snapshot.tables.game_names;
        db().run('UPDATE game_saves SET data = ? WHERE id = ?', [bytes(JSON.stringify(snapshot)), id]);
        db().run("INSERT INTO game_names (name, is_male) VALUES ('Newer', 1)");
        expect(Saves.restore(boss, id!)).toBeNull();
        expect(Number(scalar("SELECT COUNT(*) FROM game_names WHERE name = 'Newer'"))).toBe(1);
    });

    test('restore refusals', () => {
        const boss = admin();
        expect(Saves.restore(boss, 999999)).toBe('That save no longer exists.');
        db().run('INSERT INTO game_saves (name, anthros, data) VALUES (?, 0, ?)', ['Broken', bytes('not json')]);
        expect(Saves.restore(boss, db().lastInsertId())).toBe("That save can't be read.");
    });

    // Not upstream: foreign keys are checked again after a restore.
    test('restore turns foreign keys back on', () => {
        const boss = admin();
        const [id] = Saves.create(boss, 'Keys');
        expect(Saves.restore(boss, id!)).toBeNull();
        expect(Number(scalar('PRAGMA foreign_keys'))).toBe(1);
        expect(db().all('PRAGMA foreign_key_check')).toEqual([]);
    });
});
