// Upstream: tests/Game/NamesTest.php
import { describe, expect, test } from 'vitest';
import { Names } from '../../src/game/Names';
import { anthro, anthroOf, db, scalar, user } from '../TestCase';

describe('Names', () => {
    const flags = (name: string) => {
        const row = db().row('SELECT is_male, is_female FROM game_names WHERE name = ?', [name])!;
        return { is_male: Number(row.is_male), is_female: Number(row.is_female) };
    };

    test('seeded counts', () => {
        expect(Names.counts()).toEqual({ male: 200, female: 200, neutral: 200, unused: 0 });
    });

    test('random respects presentation', () => {
        for (let i = 0; i < 50; i++) {
            expect(flags(Names.random(0, 'male')).is_male).toBe(1);
            expect(flags(Names.random(0, 'female')).is_female).toBe(1);
            expect(flags(Names.random(0, 'androgynous'))).toEqual({ is_male: 1, is_female: 1 });
            expect(flags(Names.random(0, null))).toEqual({ is_male: 1, is_female: 1 });
        }
    });

    test('random avoids names the owner already uses', () => {
        const owner = user('keeper');
        db().run('UPDATE game_names SET is_male = 0, is_female = 0');
        db().run("UPDATE game_names SET is_male = 1, is_female = 1 WHERE name IN ('Ash', 'Birch')");
        anthro({ name: 'Ash', owner });
        for (let i = 0; i < 20; i++) {
            expect(Names.random(anthroOf(owner), null)).toBe('Birch');
        }
        // Unowned anthros (owner 0) are checked against other unowned anthros.
        anthro({ name: 'Birch' });
        for (let i = 0; i < 20; i++) {
            expect(Names.random(0, null)).toBe('Ash');
        }
    });

    test('random repeats once every name is used', () => {
        const owner = user('keeper');
        db().run("UPDATE game_names SET is_male = 0, is_female = 0 WHERE name <> 'Ash'");
        anthro({ name: 'Ash', owner });
        expect(Names.random(anthroOf(owner), 'male')).toBe('Ash');
    });

    test('random with no suitable names', () => {
        db().run('UPDATE game_names SET is_male = 0, is_female = 0');
        expect(Names.random(0, 'female')).toBe('Nameless');
    });

    test('add', () => {
        const [added, error] = Names.add('Zorro, Zara\nAsh\n\nZorro', true, false);
        expect(error).toBeNull();
        expect(added, 'Duplicates and names already listed are skipped.').toBe(2);
        expect(flags('Zara')).toEqual({ is_male: 1, is_female: 0 });
        expect(Names.add(' \n, ', true, true)).toEqual([null, 'Enter at least one name.']);
        expect(Names.add('a'.repeat(65), true, true)).toEqual([null, 'Names must be 1-64 characters.']);
    });

    test('update', () => {
        Names.add('Zara', true, true);
        const id = Number(scalar("SELECT id FROM game_names WHERE name = 'Zara'"));
        expect(Names.update(id, ' Zarina ', false, true)).toBeNull();
        expect(flags('Zarina')).toEqual({ is_male: 0, is_female: 1 });
        expect(Names.update(id, 'Axel', true, false)).toBe('Axel is already in the list.');
        expect(Names.update(id, '', true, false)).toBe('Names must be 1-64 characters.');
    });

    test('delete and all', () => {
        const ids = Names.all().slice(0, 3).map((n) => n.id);
        expect(Names.delete([])).toBe(0);
        expect(Names.delete([...ids, ids[0]])).toBe(3);
        expect(Names.all()).toHaveLength(597);
        const first = Names.all()[0];
        expect(typeof first.is_male).toBe('boolean');
    });

    test('counts include unused names', () => {
        Names.add('Nobody', false, false);
        expect(Names.counts().unused).toBe(1);
        expect(Names.random(0, null)).not.toBe('Nobody');
    });

    test('seed only fills missing names', () => {
        db().run("DELETE FROM game_names WHERE name = 'Axel'");
        Names.seed(db());
        expect(flags('Axel')).toEqual({ is_male: 1, is_female: 0 });
        expect(Names.all()).toHaveLength(600);
    });
});
