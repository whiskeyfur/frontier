// Upstream: tests/Game/PreferencesTest.php
import { describe, expect, test } from 'vitest';
import { gmdate, strtotimeOrThrow } from '../../src/core/php';
import type { Row } from '../../src/db/Db';
import { Anthros } from '../../src/game/Anthros';
import { Preferences } from '../../src/game/Preferences';
import { Schedules } from '../../src/game/Schedules';
import { Socials } from '../../src/game/Socials';
import { anthro, player, playerAnthro, scalar } from '../TestCase';

describe('Preferences', () => {
    const young = (fields: Row = {}) =>
        // 12 weeks old, and fertile.
        anthro({ birthdate: gmdate('Y-m-d', strtotimeOrThrow('-12 weeks')), fertile_on: gmdate('Y-m-d', strtotimeOrThrow('-1 day')), ...fields });

    test('the era', () => {
        const alice = player('alice');
        expect(Preferences.era(alice.id), 'The Dark Ages by default.').toBe('dark');
        expect(Preferences.setEra(alice, 'modern')).toBe('Choose the Dark Ages or the Renaissance.');
        expect(Preferences.setEra(alice, 'renaissance')).toBeNull();
        expect(Preferences.era(alice.id)).toBe('renaissance');
        expect(Preferences.era(null)).toBe('dark');
    });

    test('the renaissance brings the arts', () => {
        expect([...Schedules.skills('dark').values()]).not.toContain('Painting');
        expect([...Schedules.skills('renaissance').values()]).toContain('Painting');
        expect([...Schedules.occupations('renaissance').values()].map((o) => o.title), 'The old trades too.').toContain('Farmer');
        const dark: string[] = [...Schedules.occupations('dark').values()].map((o) => o.title);
        const renaissance: string[] = [...Schedules.occupations('renaissance').values()].map((o) => o.title);
        expect(renaissance.filter((t) => !dark.includes(t))).toEqual(
            ['Actor', 'Architect', 'Composer', 'Engraver', 'Illuminator', 'Jester', 'Painter', 'Playwright', 'Poet', 'Printer', 'Sculptor', 'Stonecarver'],
        );

        const alice = player('alice');
        const me = playerAnthro(alice);
        const painting = Number(scalar("SELECT id FROM game_skills WHERE name = 'Painting'"));
        expect(Schedules.planDay(alice, me, gmdate('Y-m-d'), 'train', 's:' + painting), 'Not in the Dark Ages.').toBe('Choose a skill to train.');
        Preferences.setEra(alice, 'renaissance');
        expect(Schedules.planDay(alice, me, gmdate('Y-m-d'), 'train', 's:' + painting)).toBeNull();
    });

    test("the renaissance won't breed the young", () => {
        const alice = player('alice');
        playerAnthro(alice);
        const sire = young({ owner: alice, name: 'Lad' });
        const dam = anthro({ owner: alice, gender: 'Female', name: 'Dame' });
        expect(Anthros.breed(alice.id, sire.id, dam.id)[1], 'The Dark Ages allow it.').toBeNull();

        Preferences.setEra(alice, 'renaissance');
        const refusal = 'Lad is too young: in the Renaissance, no one is bred before 14 weeks old.';
        expect(Anthros.breed(alice.id, sire.id, dam.id)).toEqual([null, refusal]);
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings')), 'Not even attempted.').toBe(1);
        const older = anthro({ owner: alice, name: 'Man' });
        expect(Anthros.breed(alice.id, older.id, dam.id)[1]).toBeNull();

        const herm = young({ owner: alice, gender: 'Herm', name: 'Kit' });
        expect(Anthros.selfBreed(alice, herm.id, 1)).toEqual([null, 'Kit is too young: in the Renaissance, no one is bred before 14 weeks old.']);

        Schedules.planDay(alice, sire, gmdate('Y-m-d'), 'breed', 'p:' + dam.id);
        Schedules.runToday();
        expect(Schedules.log(sire.id)[0].outcome).toBe(`Didn't breed with Dame: ${refusal}`);
    });

    test("a flirt follows both players' eras", () => {
        const alice = player('alice');
        const bob = player('bobby');
        playerAnthro(alice, { name: 'Mack' });
        const fern = playerAnthro(bob, {
            name: 'Fern', gender: 'Female', birthdate: gmdate('Y-m-d', strtotimeOrThrow('-12 weeks')),
            fertile_on: gmdate('Y-m-d', strtotimeOrThrow('-1 day')),
        });
        Preferences.setEra(bob, 'renaissance');
        Socials.flirt(alice, fern.id, '');
        expect(Socials.respond(bob, Number(Socials.forAnthro(fern.id)[0].id), true)).toBeNull();
        const flirt = Socials.forAnthro(fern.id)[0];
        expect([flirt.status, flirt.barren_reason]).toEqual(['accepted', 'Fern is too young: in the Renaissance, no one is bred before 14 weeks old.']);
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings'))).toBe(0);
    });
});
