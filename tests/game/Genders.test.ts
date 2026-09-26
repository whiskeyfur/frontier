import { describe, expect, test } from 'vitest';
import { Genders } from '../../src/game/Genders';
import { anthro, db, genderId, scalar, sorted } from '../TestCase';

describe('Genders', () => {
    const fields = (overrides: Record<string, unknown> = {}) => ({
        name: 'Neuter', is_male: 0, is_female: 0, presents_as: 'androgynous', birth_weight: 0, sort_order: 60, ...overrides,
    });

    test('seeded genders', () => {
        const all = Genders.all();
        expect(all.map((g) => g.name)).toEqual(['Male', 'Female', 'Herm', 'Trans male', 'Trans female']);
        const herm = all[2];
        expect(herm.is_male).toBe(true);
        expect(herm.is_female).toBe(true);
        expect(herm.presents_as).toBe('androgynous');
        expect(Number(herm.anthros)).toBe(0);
    });

    test('find', () => {
        const male = Genders.find(genderId('Male'))!;
        expect(male.presents_as).toBe('male');
        expect(male.is_male).toBe(true);
        expect(male.is_female).toBe(false);
        expect(Genders.find(999999)).toBeNull();
    });

    test('random birth id follows weights', () => {
        const born = new Set<string>();
        for (let i = 0; i < 200; i++) {
            born.add(Genders.find(Genders.randomBirthId())!.name);
        }
        // Only Male and Female have a birth weight.
        expect(sorted(born)).toEqual(sorted(['Male', 'Female']));
    });

    test('random birth id with all weights zero picks any', () => {
        db().run('UPDATE game_genders SET birth_weight = 0');
        expect(Genders.find(Genders.randomBirthId())).not.toBeNull();
    });

    test('add, update, validation', () => {
        expect(Genders.add(fields())).toBeNull();
        const id = Number(scalar("SELECT id FROM game_genders WHERE name = 'Neuter'"));
        expect(Genders.add(fields({ name: 'Male' }))).toBe('"Male" already exists.');
        expect(Genders.add(fields({ name: ' ' }))).toBe('Names must be 1-64 characters.');
        expect(Genders.add(fields({ name: 'X', presents_as: 'other' }))).toBe('Choose how the gender presents.');
        expect(Genders.add(fields({ name: 'X', birth_weight: -1 }))).toBe('Birth weight cannot be negative.');

        expect(Genders.update(id, fields({ name: 'Agender', is_female: 1, birth_weight: 5 }))).toBeNull();
        const updated = Genders.find(id)!;
        expect(updated.name).toBe('Agender');
        expect(updated.is_female).toBe(true);
        expect(Number(updated.birth_weight)).toBe(5);
    });

    test('delete refuses genders in use', () => {
        anthro({ gender: 'Herm' });
        expect(Genders.delete(genderId('Herm'))).toBe("That gender can't be deleted while 1 anthro or player has it.");
        expect(Genders.delete(genderId('Trans male'))).toBeNull();
        expect(Genders.find(genderId('Trans male'))).toBeNull();
    });

    test('delete keeps at least one gender', () => {
        db().run("DELETE FROM game_genders WHERE name <> 'Male'");
        expect(Genders.delete(genderId('Male'))).toBe('There must be at least one gender.');
    });
});
