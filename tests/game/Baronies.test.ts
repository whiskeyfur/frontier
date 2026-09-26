// Upstream: tests/Game/BaroniesTest.php
import { describe, expect, test } from 'vitest';
import type { Row } from '../../src/db/Db';
import { gmdate, strtotimeOrThrow } from '../../src/core/php';
import { Anthros } from '../../src/game/Anthros';
import { Baronies } from '../../src/game/Baronies';
import { Land } from '../../src/game/Land';
import { Litters } from '../../src/game/Litters';
import { Ranks } from '../../src/game/Ranks';
import {
    admin, anthro, baronyId, db, genderId, notificationsFor, player, playerAnthro, refresh, scalar, speciesId,
} from '../TestCase';

describe('Baronies', () => {
    /**
     * A small court: King, a duke, a baron under him with a baronet, and a knight under the baronet.
     */
    const court = () => {
        const king = anthro({ name: 'Rex', title_rank: 9 });
        const duke = anthro({ name: 'Duc', title_rank: 8, liege_id: king.id });
        const baron = anthro({ name: 'Bram', title_rank: 4, liege_id: duke.id });
        const baronet = anthro({ name: 'Bet', title_rank: 3, liege_id: baron.id });
        const knight = anthro({ name: 'Kay', title_rank: 2, liege_id: baronet.id });
        return { king, duke, baron, baronet, knight };
    };

    const baronyOf = (holderId: number): Row => [...Baronies.all().values()].find((b) => b.holder_anthro_id === holderId)!;

    // The part of the barony the anthro manages.
    const partOf = (barony: Row, managerId: number): Row => (barony.parts as Row[]).find((p) => p.manager_anthro_id === managerId)!;

    test('a court gets a barony for each baron and the crown', () => {
        const { king, baron, baronet, knight } = court();
        expect(Baronies.createForCourt()).toBe(2);
        const crown = baronyOf(king.id);
        const barony = baronyOf(baron.id);
        expect(barony.name).not.toBe(crown.name);
        expect(barony.parts, 'Parts of the baron\'s barony for the lords in his service...').toHaveLength(2);
        expect(['town', 'city'], '...a town or city for the baronet...').toContain(partOf(barony, baronet.id).kind);
        expect(['village', 'manor', 'expanse'], '...and a village, manor or expanse for his knight.').toContain(partOf(barony, knight.id).kind);
        expect(crown.parts).toEqual([]);
    });

    test('founding a realm', () => {
        const boss = admin();
        const [baronId, made] = Baronies.foundRealm(boss.id);
        Ranks.createCommoners();
        Baronies.layOut();
        expect(made, 'A Baron and a baronet for each of 8 parts.').toBe(9);
        const baronies = Baronies.all(true);
        expect(baronies.size).toBe(1);
        const barony = [...baronies.values()][0];
        expect(barony.holder_anthro_id).toBe(baronId);
        expect(Anthros.player(boss.id)!.id, 'Played by the admin.').toBe(baronId);
        const kinds: Record<string, number> = {};
        for (const part of barony.parts) kinds[part.kind] = (kinds[part.kind] ?? 0) + 1;
        expect(kinds).toEqual({ expanse: 2, town: 1, village: 5 });
        for (const part of barony.parts) {
            if (part.kind === 'expanse') {
                expect(part.people, 'Only its baronet lives on an expanse.').toBe(1);
            }
        }
    });

    test('land is placed where its owner is sworn', () => {
        const { baron, knight } = court();
        Baronies.createForCourt();
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, 2), (NULL, 3), (NULL, 4)', [knight.id]);
        expect(Baronies.placeParcels()).toBe(3);
        const barony = baronyOf(baron.id);
        const knights = db().row('SELECT barony_id, part_id FROM game_parcels WHERE acres = 2')!;
        expect([knights.barony_id, knights.part_id], 'The knight\'s land lies in the part the knight manages.')
            .toEqual([barony.id, partOf(barony, knight.id).id]);
        expect(Number(scalar('SELECT COUNT(*) FROM game_parcels WHERE barony_id IS NULL'))).toBe(0);
        expect(Number(scalar('SELECT COUNT(DISTINCT barony_id) FROM game_parcels WHERE anthro_id IS NULL')), 'Spread out.').toBe(2);
    });

    test('the realm tree and holdings direct and through', () => {
        const { king, duke, baron, baronet } = court();
        Baronies.createForCourt();
        const barony = baronyOf(baron.id);
        db().run('INSERT INTO game_parcels (anthro_id, acres, barony_id) VALUES (NULL, 5, ?)', [barony.id]);

        const tree = Baronies.tree();
        expect(tree.roots).toHaveLength(1);
        const root = tree.roots[0];
        expect(root.id).toBe(king.id);
        expect(root.branch).toEqual({ baronies: 2, acres: 5.0 });
        expect(root.children[0].id).toBe(duke.id);
        expect(root.children[0].children[0].children, 'The baronet holds no barony, so isn\'t a branch.').toEqual([]);

        expect(Baronies.holdingsOf(baron.id).held.map((b) => b.id)).toEqual([barony.id]);
        const through = Baronies.holdingsOf(duke.id).through;
        expect(through.map((b) => b.id)).toEqual([barony.id]);
        expect(through[0].via.id).toBe(baron.id);
        expect([...Baronies.holdingsOf(king.id).held, ...Baronies.holdingsOf(king.id).through]).toHaveLength(2);
        expect(Baronies.holdingsOf(baronet.id).managed.map((p) => p.id)).toEqual([partOf(barony, baronet.id).id]);
        expect(Baronies.find(barony.id)!.through.map((a: Row) => a.id)).toEqual([duke.id, king.id]);
    });

    test('holdings follow titles', () => {
        const { duke, baron, baronet } = court();
        Baronies.createForCourt();
        const baronyIdOf = baronyOf(baron.id).id;
        const partId = partOf(baronyOf(baron.id), baronet.id).id;
        const heir = anthro({ name: 'Heir', sire_id: baron.id });

        // A hereditary barony passes with the title; the baronet's part (no heir) goes back to the barony.
        for (const lord of [baron, baronet]) {
            db().run('UPDATE game_anthros SET owner_id = ? WHERE id = ?', [duke.id, lord.id]);
            Ranks.strip(lord);
        }
        expect(Baronies.all().get(baronyIdOf)!.holder_anthro_id).toBe(heir.id);
        expect((Baronies.all().get(baronyIdOf)!.parts as Row[]).find((p) => p.id === partId)!.manager_anthro_id).toBeNull();

        // Made a knight, the heir can't hold it: it goes up to his liege.
        expect(Ranks.grant(admin(), heir.id, Ranks.KNIGHT)).toBeNull();
        db().run('UPDATE game_anthros SET liege_id = ? WHERE id = ?', [duke.id, heir.id]);
        expect(Baronies.settle()).toBe(1);
        expect(Baronies.all().get(baronyIdOf)!.holder_anthro_id).toBe(duke.id);
    });

    test('admin changes', () => {
        const { baron, baronet, knight } = court();
        expect(Baronies.create('Oakdale', baronet.id)).toEqual([null, 'Only a free Baron or higher can hold a barony.']);
        const [created, error] = Baronies.create(' Oakdale ', baron.id);
        const id = created!;
        expect(error).toBeNull();
        expect(notificationsFor(baron.id)).toContain('The crown granted you the barony of Oakdale.');
        expect(Baronies.create('Oakdale', null)).toEqual([null, "There's already a barony called Oakdale."]);

        expect(Baronies.savePart(id, null, 'Millton', 'town', knight.id)).toBe('Only a free Baronet or higher can manage a town.');
        expect(Baronies.savePart(id, null, 'Wilds', 'expanse', anthro().id)).toBe('Only a free Knight or higher can manage an expanse.');
        expect(Baronies.savePart(id, null, 'Kayhold', 'manor', knight.id), 'A knight manages a manor.').toBeNull();
        expect(Baronies.savePart(id, null, 'Millton', 'castle', null)).toBe('Choose a village, a manor, a town, a city or an expanse.');
        expect(Baronies.savePart(id, null, 'Millton', 'town', baronet.id)).toBeNull();
        const partId = Number(Baronies.all().get(id)!.parts[0].id);
        expect(Baronies.savePart(id, null, 'millton', 'village', null)).toBe('Oakdale already has a part called Millton.');
        expect(Baronies.savePart(id, partId, 'Millbury', 'village', null)).toBeNull();
        const part = Baronies.all().get(id)!.parts[0];
        expect([part.name, part.kind, part.manager_anthro_id]).toEqual(['Millbury', 'village', null]);

        expect(Baronies.update(id, 'Oakvale', null)).toBeNull();
        expect(Baronies.all().get(id)!.name).toBe('Oakvale');

        db().run('INSERT INTO game_parcels (acres) VALUES (3)');
        const parcel = db().lastInsertId();
        expect(Baronies.moveParcel(parcel, id, 999)).toBe('Choose a part of Oakvale, or none.');
        expect(Baronies.moveParcel(parcel, id, partId)).toBeNull();
        expect(Baronies.delete(id)).toBe('Land lies in Oakvale: move its lots to another barony first.');
        expect(Baronies.deletePart(partId)).toBeNull();
        expect(scalar('SELECT part_id FROM game_parcels WHERE id = ?', [parcel]), 'Its land stays in the barony.').toBeNull();
    });

    test('split land stays where it lies', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        const barony = baronyId();
        db().run('INSERT INTO game_parcels (anthro_id, acres, barony_id) VALUES (?, 10, ?)', [me.id, barony]);
        expect(Land.sell(alice, db().lastInsertId(), 4, 100)).toBeNull();
        expect(db().column('SELECT barony_id FROM game_parcels').map(Number)).toEqual([barony, barony]);
    });

    test('where anthros live follows fealty', () => {
        const { baron, baronet, knight } = court();
        Baronies.createForCourt();
        const barony = baronyOf(baron.id);
        const part = Number(partOf(barony, baronet.id).id);
        const knightsPart = Number(partOf(barony, knight.id).id);
        const villager = anthro({ liege_id: baronet.id });
        const knightsMan = anthro({ liege_id: knight.id });
        const retainer = anthro({ liege_id: baron.id });
        const slave = anthro({ owner_id: villager.id, liege_id: villager.id });
        const nowhere = anthro();

        const home = Baronies.residences();
        expect(home.get(villager.id)).toEqual([barony.id, part]);
        expect(home.get(knightsMan.id), 'Sworn to a knight: in the part the knight manages.').toEqual([barony.id, knightsPart]);
        expect(home.get(slave.id), 'Owned anthros live with their owners.').toEqual([barony.id, part]);
        expect(home.get(retainer.id), 'In the barony, but in no part of it.').toEqual([barony.id, null]);
        expect(home.has(nowhere.id)).toBe(false);
        expect(Baronies.residenceOf(villager.id)!.part_id).toBe(part);
        expect(Baronies.residenceOf(nowhere.id)).toBeNull();
        expect(Baronies.all(true).get(barony.id)!.people, 'Everyone living in it: the baron, the baronet, the knight, and those four.').toBe(7);
    });

    test('laying out the land', () => {
        const { baron, baronet } = court();
        const townBaronet = anthro({ title_rank: 3, liege_id: baron.id });
        Baronies.createForCourt();
        const barony = baronyOf(baron.id);
        const village = Number((barony.parts as Row[]).find((p) => p.manager_anthro_id === baronet.id)!.id);
        const town = Number((barony.parts as Row[]).find((p) => p.manager_anthro_id === townBaronet.id)!.id);
        db().run("UPDATE game_barony_parts SET kind = IF(id = ?, 'village', 'town') WHERE barony_id = ?", [village, barony.id]);
        const mother = anthro({ gender: 'Female', liege_id: baronet.id });
        anthro({ dam_id: mother.id, owner_id: mother.id, liege_id: mother.id, young: 1, fertile_on: gmdate('Y-m-d', strtotimeOrThrow('+3 weeks')) });
        const farmer = anthro({ liege_id: baronet.id });
        const slave = anthro({ owner_id: farmer.id, liege_id: farmer.id });
        anthro({ liege_id: townBaronet.id });

        Baronies.layOut();
        const acres = (anthroId: number, partId: number): number[] => db().column(
            `SELECT acres FROM game_parcels WHERE anthro_id = ${anthroId} AND part_id = ${partId}`,
        ).map(Number);
        expect(acres(farmer.id, village), 'One lot of 10 acres per villager.').toEqual([10.0]);
        expect(acres(mother.id, village), 'A mother farms 10 acres for each young one she raises.').toEqual([20.0]);
        expect(acres(slave.id, village), 'Owned anthros hold no land.').toEqual([]);
        const [core] = acres(baronet.id, village);
        expect(core >= 10 && core <= 50, `The village core: ${core} acres.`).toBe(true);
        const townLots = acres(townBaronet.id, town);
        expect(townLots, 'A town is one lot, its baronet\'s.').toHaveLength(1);
        expect(townLots[0] >= 40 && townLots[0] <= 50).toBe(true);
        expect(Number(scalar('SELECT COUNT(*) FROM game_parcels WHERE part_id = ? AND anthro_id <> ?', [town, townBaronet.id])),
            'Townspeople hold no land.').toBe(0);
        expect(Baronies.layOut(), 'Laid out once.').toBe(0);
    });

    test('a city\'s lots follow its people', () => {
        const { baron, baronet } = court();
        Baronies.createForCourt();
        const city = Number(partOf(baronyOf(baron.id), baronet.id).id);
        db().run("UPDATE game_barony_parts SET kind = 'city' WHERE id = ?", [city]);
        const rows = Array.from({ length: Baronies.CITY_PEOPLE_PER_LOT + 1 },
            () => `('Citizen', ${genderId('Male')}, ${speciesId()}, ${baronet.id})`).join(', ');
        db().exec(`INSERT INTO game_anthros (name, gender_id, species_id, liege_id) VALUES ${rows}`);
        Anthros.freeUnowned();
        Baronies.layOut();
        expect(Number(scalar('SELECT COUNT(*) FROM game_parcels WHERE part_id = ? AND anthro_id = ?', [city, baronet.id])),
            'One lot for each 300 people (and the baronet makes it more than 300).').toBe(2);
    });

    test('the court\'s commoners', () => {
        const { king, baron, baronet, knight } = court();
        Baronies.createForCourt();
        db().run("UPDATE game_barony_parts SET kind = 'village'");
        const created = Ranks.createCommoners();
        const sworn = (lord: Row) => Number(scalar('SELECT COUNT(*) FROM game_anthros WHERE liege_id = ? AND title_rank IS NULL', [lord.id]));
        for (const lord of [king, baron]) {
            expect(sworn(lord) >= 1 && sworn(lord) <= 3, `${lord.name}: ${sworn(lord)} retainers.`).toBe(true);
        }
        const [low, high] = Baronies.PEOPLE.village;
        for (const lord of [baronet, knight]) {
            expect(sworn(lord) >= low && sworn(lord) <= high, `${lord.name}'s village: ${sworn(lord)} people.`).toBe(true);
        }
        expect(Number(scalar('SELECT COUNT(*) FROM game_anthros WHERE title_rank IS NULL'))).toBe(created);
    });

    test('cubs of an owned mother belong to her owner and grow up free', () => {
        const owner = anthro({ name: 'Master' });
        const mother = anthro({ gender: 'Female', owner_id: owner.id, liege_id: owner.id });
        Litters.attempt(anthro(), mother, null, false);
        db().run('UPDATE game_litters SET due_on = UTC_DATE()');
        Litters.deliverDue();
        let cub = Anthros.findAny(Number(scalar('SELECT id FROM game_anthros WHERE dam_id = ?', [mother.id])))!;
        expect(cub.owner_id).toBe(owner.id);
        expect(Ranks.sworn(owner.id).children.map((c: Row) => c.id)).toEqual([cub.id]);

        db().run('UPDATE game_anthros SET fertile_on = UTC_DATE() WHERE id = ?', [cub.id]);
        Anthros.comeOfAge();
        cub = refresh(cub);
        expect(Anthros.isFree(cub), 'Grown, it goes free all the same.').toBe(true);
        expect(cub.young).toBe(0);
        expect(notificationsFor(owner.id)).toContain(`${cub.name} has grown up and is free now.`);
        expect(Land.totalAcres(cub.id), 'No land: it wasn\'t raised on a village lot.').toBe(0.0);
    });

    test('cubs of a free mother are hers and grow up free', () => {
        const { baron, baronet } = court();
        Baronies.createForCourt();
        const village = Number(partOf(baronyOf(baron.id), baronet.id).id);
        db().run("UPDATE game_barony_parts SET kind = 'village' WHERE id = ?", [village]);
        const mother = anthro({ name: 'Ma', gender: 'Female', liege_id: baronet.id });
        Baronies.layOut();
        Litters.attempt(anthro(), mother, null, false);
        db().run('UPDATE game_litters SET due_on = UTC_DATE()');
        Litters.deliverDue();

        let cub = Anthros.findAny(Number(scalar('SELECT id FROM game_anthros WHERE dam_id = ?', [mother.id])))!;
        expect(cub.owner_id, 'A free mother\'s young are hers.').toBe(mother.id);
        expect(Anthros.isYoung(cub)).toBe(true);
        expect(Ranks.title(cub)).toBe('Child');
        expect(Baronies.residenceOf(cub.id)!.part_id, 'So they live where she does.').toBe(village);
        expect(Land.totalAcres(mother.id), 'She farms 10 more acres for it.').toBe(20.0);
        expect(Ranks.sworn(mother.id).children.map((c: Row) => c.id)).toEqual([cub.id]);

        expect(Anthros.comeOfAge(), 'Not fertile yet.').toBe(0);
        db().run('UPDATE game_anthros SET fertile_on = UTC_DATE() WHERE id = ?', [cub.id]);
        expect(Anthros.comeOfAge()).toBe(1);
        cub = refresh(cub);
        expect(Anthros.isFree(cub), 'Grown, it goes free...').toBe(true);
        expect(cub.liege_id, '...sworn where it grew up...').toBe(baronet.id);
        expect(Land.totalAcres(cub.id), '...with its 10 acres.').toBe(10.0);
        expect(Land.totalAcres(mother.id)).toBe(10.0);
        expect(notificationsFor(mother.id)).toContain(`${cub.name} has grown up and is free now.`);
    });
});
