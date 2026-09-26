// Upstream: tests/Game/SpeciesTest.php
import { describe, expect, test } from 'vitest';
import { Species } from '../../src/game/Species';
import { anthro, scalar, speciesId } from '../TestCase';

describe('Species', () => {
    test('grouped is ordered by group then name', () => {
        const grouped = Species.grouped();
        expect([...grouped.keys()][0]).toBe('Canines');
        expect([...grouped.get('Canines')!.values()]).toContain('Wolf');
        const names = [...grouped.get('Canines')!.values()];
        // PHP's sort(): byte order.
        const sortedNames = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        expect(names).toEqual(sortedNames);
        expect([...grouped.values()].reduce((sum, g) => sum + g.size, 0)).toBe(37);
    });

    test('groups with species includes empty groups and counts', () => {
        Species.addGroup('Empty', 999);
        anthro();
        const groups = Species.groupsWithSpecies();
        expect(groups[groups.length - 1].name).toBe('Empty');
        expect(groups[groups.length - 1].species).toEqual([]);
        const wolf = groups[0].species.find((s: { name: string }) => s.name === 'Wolf');
        expect(Number(wolf.anthros)).toBe(1);
    });

    test('exists', () => {
        expect(Species.exists(speciesId('Wolf'))).toBe(true);
        expect(Species.exists(999999)).toBe(false);
    });

    test('add and update species', () => {
        const group = Number(scalar("SELECT id FROM game_species_groups WHERE name = 'Canines'"));
        expect(Species.addSpecies('  Dingo ', group)).toBeNull();
        expect(Species.exists(speciesId('Dingo'))).toBe(true);
        expect(Species.addSpecies('Wolf', group)).toBe('"Wolf" already exists.');
        expect(Species.addSpecies('Dhole', 999999)).toBe('Choose a group.');
        expect(Species.addSpecies('', group)).toBe('Names must be 1-64 characters.');
        expect(Species.updateSpecies(speciesId('Dingo'), 'Dingo dog', group)).toBeNull();
        expect(Species.exists(speciesId('Dingo dog'))).toBe(true);
    });

    test('delete species in use', () => {
        anthro({ species_id: speciesId('Wolf') });
        expect(Species.deleteSpecies(speciesId('Wolf'))).toBe("That species can't be deleted while 1 anthro has it.");
        expect(Species.deleteSpecies(speciesId('Coyote'))).toBeNull();
        expect(Species.exists(speciesId('Coyote'))).toBe(false);
    });

    test('groups', () => {
        expect(Species.addGroup('Reptiles', 50)).toBeNull();
        const id = Number(scalar("SELECT id FROM game_species_groups WHERE name = 'Reptiles'"));
        expect(Species.addGroup('Canines', 1)).toBe('"Canines" already exists.');
        expect(Species.updateGroup(id, 'Scaly', 1)).toBeNull();
        expect(Species.groupsWithSpecies()[0].name).toBe('Scaly');
        const canines = Number(scalar("SELECT id FROM game_species_groups WHERE name = 'Canines'"));
        expect(Species.deleteGroup(canines)).toBe('Move or delete the species in that group first.');
        expect(Species.deleteGroup(id)).toBeNull();
    });
});
