// Upstream: tests/Game/LittersTest.php
import { describe, expect, test } from 'vitest';
import type { User } from '../../src/core/Auth';
import { gmdate, range } from '../../src/core/php';
import type { Row } from '../../src/db/Db';
import { Anthros } from '../../src/game/Anthros';
import { Litters } from '../../src/game/Litters';
import { admin, anthro, anthroOf, db, notificationsFor, player, playerAnthro, refresh, scalar, speciesId } from '../TestCase';

describe('Litters', () => {
    const pair = (): [User, Row, Row] => {
        const alice = player('alice');
        return [
            alice,
            anthro({ owner: alice, gender: 'Male', species_id: speciesId('Wolf') }),
            anthro({ owner: alice, gender: 'Female', species_id: speciesId('Lion'), name: 'Fern' }),
        ];
    };

    test('same day attempts add cubs up to the maximum', () => {
        const [alice, sire, dam] = pair();
        for (let i = 1; i <= Litters.MAX_CUBS; i++) {
            const outcome = Litters.attempt(sire, dam, alice.id, false);
            expect(Number(outcome.litter!.cubs)).toBe(i);
        }
        const outcome = Litters.attempt(sire, dam, alice.id, false);
        expect(outcome.litter).toBeNull();
        expect(outcome.barren).toBe('Fern litter full');
        expect(Number(scalar('SELECT COUNT(*) FROM game_litters'))).toBe(1);
    });

    test('a pregnancy from another day makes attempts barren', () => {
        const [alice, sire, dam] = pair();
        Litters.attempt(sire, dam, alice.id, false);
        db().exec('UPDATE game_litters SET bred_on = SUBDATE(UTC_DATE(), 1)');
        const outcome = Litters.attempt(sire, dam, alice.id, false);
        expect(outcome.barren!.startsWith('Fern pregnant, due')).toBe(true);
        const forced = Litters.attempt(sire, dam, alice.id, true);
        expect(Number(forced.litter!.cubs), 'Forced breeding may add to it.').toBe(2);
    });

    test('both parents are told each time', () => {
        let [alice, sire, dam] = pair();
        sire = refresh(sire);
        Litters.attempt(sire, dam, alice.id, false);
        const due = Litters.pending(dam.id)!.due_on;
        expect(notificationsFor(sire.id)).toEqual(['You were bred with Fern: Fern is expecting a litter of 1.']);
        expect(notificationsFor(dam.id)).toEqual([`You were bred with ${sire.name}: you're expecting a litter of 1, due ${due}.`]);

        Litters.attempt(dam, sire, alice.id, false);
        // Roles swapped: Fern as the sire. Same partners, still unread: squashed into one, showing the latest outcome.
        expect(notificationsFor(sire.id)).toEqual(["You were bred with Fern: no litter will come of it (Fern can't sire (Female))."]);
        expect(notificationsFor(dam.id)).toEqual([`You were bred with ${sire.name}: no litter will come of it (Fern can't sire (Female)).`]);
        expect(Number(scalar('SELECT times FROM game_notifications WHERE anthro_id = ?', [sire.id]))).toBe(2);
        for (const body of [...notificationsFor(sire.id), ...notificationsFor(dam.id)]) {
            expect(body, 'Never who bred them.').not.toContain('alice');
        }
    });

    test('forced and group breedings are told too', () => {
        const [, sire, dam] = pair();
        Litters.attempt(sire, dam, admin().id, true);
        expect(notificationsFor(sire.id)).toHaveLength(1);
        db().exec("INSERT INTO game_breeding_groups (id, name) VALUES (9, 'Hearth')");
        Litters.attempt(sire, dam, null, false, null, 9);
        expect(notificationsFor(sire.id)[0].startsWith('You were bred with Fern on your own, as members of Hearth:')).toBe(true);
    });

    test('eight breedings are one notification', () => {
        const [alice, sire, dam] = pair();
        for (let i = 0; i < 8; i++) {
            Litters.attempt(sire, dam, alice.id, false);
        }
        const row = db().all(`SELECT body, times FROM game_notifications WHERE anthro_id = ${dam.id}`);
        expect(row).toHaveLength(1);
        expect(row[0].times).toBe(8);
        expect(row[0].body, 'The latest outcome.').toContain("you're expecting a litter of 8");

        // Once read, the next one starts afresh.
        db().exec('UPDATE game_notifications SET read_at = UTC_TIMESTAMP()');
        Litters.attempt(sire, dam, alice.id, false);
        expect(notificationsFor(dam.id)).toHaveLength(2);
    });

    test('pending', () => {
        const [alice, sire, dam] = pair();
        expect(Litters.pending(dam.id)).toBeNull();
        Litters.attempt(sire, dam, alice.id, false);
        const pending = Litters.pending(dam.id)!;
        expect(pending.bred_on).toBe(gmdate('Y-m-d'));
        expect(Number(pending.cubs)).toBe(1);
    });

    test('attempt records group and breeder', () => {
        const [, sire, dam] = pair();
        Litters.attempt(sire, dam, null, false, null, 77);
        const row = db().row('SELECT bred_by, group_id, forced FROM game_breedings');
        expect(row).toEqual({ bred_by: null, group_id: 77, forced: 0 });
    });

    test('deliver due births one cub per attempt', () => {
        const [alice, sire, dam] = pair();
        Litters.attempt(sire, dam, alice.id, false);
        Litters.attempt(sire, dam, alice.id, false);
        expect(Litters.deliverDue(), 'Not due yet.').toBe(0);
        db().exec('UPDATE game_litters SET due_on = UTC_DATE()');
        expect(Litters.deliverDue()).toBe(2);
        expect(Litters.deliverDue(), 'Delivered once.').toBe(0);

        const cubs = db().all(`SELECT * FROM game_anthros WHERE dam_id = ${dam.id}`);
        expect(cubs).toHaveLength(2);
        for (const cub of cubs) {
            expect(cub.owner_id, 'Cubs belong to their mother\'s owner.').toBe(anthroOf(alice));
            expect(cub.young).toBe(1);
            expect(cub.sire_id).toBe(sire.id);
            expect(cub.birthdate).toBe(gmdate('Y-m-d'));
            expect([sire.species_id, dam.species_id]).toContain(cub.species_id);
            expect(cub.fertile_on).not.toBeNull();
            expect(cub.breeding_id).not.toBeNull();
        }
        expect(notificationsFor(anthroOf(alice))).toEqual(['Fern gave birth to a litter of 2.']);
        expect(Litters.pending(dam.id)).toBeNull();
    });

    test('cubs belong to their mother\'s owner whoever bred them', () => {
        const [, sire, dam] = pair();
        const bob = player('bobby');
        Litters.attempt(sire, dam, bob.id, false, anthroOf(bob));
        db().exec('UPDATE game_litters SET due_on = UTC_DATE()');
        Litters.deliverDue();
        expect(Number(scalar(`SELECT owner_id FROM game_anthros WHERE dam_id = ${dam.id}`))).toBe(dam.owner_id);
    });

    test('a free played dam owns her cubs', () => {
        const alice = player('alice');
        const dam = playerAnthro(alice, { gender: 'Female' });
        Litters.attempt(anthro({ gender: 'Male' }), dam, alice.id, false);
        db().exec('UPDATE game_litters SET due_on = UTC_DATE()');
        Litters.deliverDue();
        expect(Number(scalar(`SELECT owner_id FROM game_anthros WHERE dam_id = ${dam.id}`))).toBe(dam.id);
        expect(notificationsFor(dam.id)).toContain('AliceAnthro gave birth to a litter of 1.');
    });

    test('cubs of a free unplayed dam are hers', () => {
        const sire = anthro({ gender: 'Male' });
        const dam = anthro({ gender: 'Female' });
        Litters.attempt(sire, dam, null, false);
        db().exec('UPDATE game_litters SET due_on = UTC_DATE()');
        Litters.deliverDue();
        const cub = Anthros.findAny(Number(scalar(`SELECT id FROM game_anthros WHERE dam_id = ${dam.id}`)))!;
        expect(Anthros.isYoung(cub)).toBe(true);
        expect(cub.liege_id, 'Sworn to her, as owned anthros are.').toBe(dam.id);
    });

    test('each dam has her own litter size', () => {
        const sire = anthro({ name: 'Rex' });
        const dam = anthro({ name: 'Fay', gender: 'Female', max_cubs: 3 });
        for (const _ of range(1, 3)) {
            expect(Litters.attempt(sire, dam, null, false).litter).not.toBeNull();
        }
        expect(Litters.attempt(sire, dam, null, false)).toEqual({ litter: null, barren: 'Fay litter full' });
        expect(Number(Litters.pending(dam.id)!.cubs)).toBe(3);
    });

    test('daughters inherit their mother\'s litter size give or take one', () => {
        for (const [mothers, [low, high]] of [[1, [1, 2]], [5, [4, 6]], [8, [7, 8]]] as [number, [number, number]][]) {
            const mother = anthro({ gender: 'Female', max_cubs: mothers });
            const seen: number[] = [];
            for (const _ of range(1, 40)) {
                seen.push(Number(anthro({ dam_id: mother.id, max_cubs: null }).max_cubs));
            }
            expect(Math.min(...seen), `From ${mothers}`).toBeGreaterThanOrEqual(low);
            expect(Math.max(...seen), `From ${mothers}`).toBeLessThanOrEqual(high);
        }
        const founders = range(1, 60).map(() => Number(anthro({ max_cubs: null }).max_cubs));
        expect(Math.min(...founders)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...founders)).toBeLessThanOrEqual(8);
        expect(new Set(founders).size, 'No mother: anywhere from 1 to 8.').toBeGreaterThan(3);
    });

    test('cubs born get their mother\'s litter size', () => {
        const sire = anthro();
        const dam = anthro({ gender: 'Female', max_cubs: 1 });
        Litters.attempt(sire, dam, null, false);
        db().exec('UPDATE game_litters SET due_on = UTC_DATE()');
        expect(Litters.deliverDue()).toBe(1);
        const cub = scalar('SELECT max_cubs FROM game_anthros WHERE dam_id = ?', [dam.id]);
        expect([1, 2]).toContain(Number(cub));
    });

    test('set max cubs', () => {
        const dam = anthro({ gender: 'Female' });
        expect(Anthros.setMaxCubs(dam, 2)).toBeNull();
        expect(Anthros.maxCubs(refresh(dam))).toBe(2);
        expect(Anthros.setMaxCubs(dam, 0)).toBe('A litter holds 1 to 8 cubs.');
        expect(Anthros.setMaxCubs(dam, 9)).toBe('A litter holds 1 to 8 cubs.');
    });

    test('forcing a birth', () => {
        const [alice, sire, dam] = pair();
        expect(Litters.forceBirth(dam.id)).toBe("She isn't expecting a litter.");
        Litters.attempt(sire, dam, alice.id, false);
        Litters.attempt(sire, dam, alice.id, false);
        expect(Litters.forceBirth(dam.id)).toBeNull();
        const cubs = db().column(`SELECT birthdate FROM game_anthros WHERE dam_id = ${dam.id}`);
        expect(cubs, 'Born today.').toEqual([gmdate('Y-m-d'), gmdate('Y-m-d')]);
        expect(Litters.pending(dam.id)).toBeNull();
        expect(notificationsFor(anthroOf(alice))).toContain('Fern gave birth to a litter of 2.');
        expect(Litters.deliverDue(), 'Not born twice.').toBe(0);
    });
});
