// Upstream: tests/Game/SocialsTest.php
import { describe, expect, test } from 'vitest';
import { Anthros } from '../../src/game/Anthros';
import { Auctions } from '../../src/game/Auctions';
import { Litters } from '../../src/game/Litters';
import { Socials } from '../../src/game/Socials';
import { Wallets } from '../../src/game/Wallets';
import { anthro, db, notificationsFor, player, playerAnthro, scalar, sorted } from '../TestCase';

describe('Socials', () => {
    test('flirting needs an anthro and someone else', () => {
        const alice = player('alice');
        const other = anthro({ name: 'Wren' });
        expect(Socials.flirt(alice, other.id, '')).toEqual([null, 'Create or become an anthro first: you flirt as your anthro.']);
        const me = playerAnthro(alice);
        expect(Socials.flirt(alice, 999999, '')).toEqual([null, 'Choose an anthro to flirt with.']);
        expect(Socials.flirt(alice, me.id, '')).toEqual([null, "You can't flirt with yourself."]);
        expect(Socials.flirt(alice, other.id, 'x'.repeat(201))).toEqual([null, 'Keep it to 200 characters.']);
    });

    test('a played anthro answers and accepting tries breeding', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const mack = playerAnthro(alice, { name: 'Mack', gender: 'Male' });
        const fern = playerAnthro(bob, { name: 'Fern', gender: 'Female' });

        expect(Socials.flirt(alice, fern.id, ' Hi there ')).toEqual(['pending', null]);
        expect(Socials.flirt(alice, fern.id, '')).toEqual([null, "There's already a flirt waiting between you and Fern."]);
        expect(notificationsFor(fern.id)).toContain('Mack is flirting with you: "Hi there"');
        let flirt = Socials.forAnthro(fern.id)[0];
        expect(flirt.message).toBe('Hi there');

        expect(Socials.respond(alice, Number(flirt.id), true)).toBe('That flirt has already been answered.'); // Only Fern answers.
        expect(Socials.respond(bob, Number(flirt.id), true)).toBeNull();
        flirt = Socials.find(Number(flirt.id))!;
        expect(flirt.status).toBe('accepted');
        expect(flirt.litter).toBe(1);
        const breeding = db().row('SELECT sire_id, dam_id, litter_id FROM game_breedings')!;
        expect([breeding.sire_id, breeding.dam_id]).toEqual([mack.id, fern.id]); // They take the roles they can.
        expect(breeding.litter_id).not.toBeNull();
        expect(notificationsFor(mack.id)[0].startsWith('You were bred with Fern')).toBe(true);
        expect(Socials.respond(bob, Number(flirt.id), false)).toBe('That flirt has already been answered.');
    });

    test('a flirt can ask to breed several times', () => {
        const alice = player('alice');
        const bob = player('bobby');
        playerAnthro(alice, { name: 'Mack' });
        const fern = playerAnthro(bob, { name: 'Fern', gender: 'Female' });
        expect(Socials.flirt(alice, fern.id, '', 0)).toEqual([null, 'Breed 1 to 8 times.']);
        expect(Socials.flirt(alice, fern.id, '', 9)).toEqual([null, 'Breed 1 to 8 times.']);

        expect(Socials.flirt(alice, fern.id, 'hey', 3)).toEqual(['pending', null]);
        expect(notificationsFor(fern.id)).toContain('Mack is flirting with you (and wants to breed 3 times): "hey"');
        const flirt = Socials.forAnthro(fern.id)[0];
        expect(flirt.times).toBe(3);
        expect(Socials.respond(bob, Number(flirt.id), true)).toBeNull();
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings WHERE litter_id IS NOT NULL'))).toBe(3);
        expect(Number(Anthros.findAny(fern.id)!.pregnant_cubs)).toBe(3); // One cub a try.
        expect(Socials.find(Number(flirt.id))!.litter).toBe(1);
    });

    test('flirting with an expecting dam fills her litter and says so', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const ravnos = playerAnthro(alice, { name: 'Ravnos' });
        const brandy = playerAnthro(bob, { name: 'Brandy', gender: 'Female' });
        for (let i = 1; i <= 3; i++) {
            Litters.attempt(ravnos, brandy, null, false);
        }
        db().run('UPDATE game_notifications SET read_at = UTC_TIMESTAMP()');

        Socials.flirt(alice, brandy.id, '', 8);
        expect(Socials.respond(bob, Number(Socials.forAnthro(brandy.id)[0].id), true)).toBeNull();
        expect(Number(Anthros.findAny(brandy.id)!.pregnant_cubs)).toBe(8);
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings'))).toBe(8); // It stops once her litter is full.
        const note = db().row(`SELECT body, times FROM game_notifications WHERE anthro_id = ${brandy.id} AND read_at IS NULL AND body LIKE 'You were bred%'`)!;
        expect(note.times).toBe(5);
        expect(note.body.startsWith("You were bred with Ravnos: you're expecting a litter of 8, due")).toBe(true);
    });

    test('a try that adds nothing still says a litter is coming', () => {
        const sire = anthro({ name: 'Rex' });
        const dam = anthro({ name: 'Fay', gender: 'Female' });
        for (let i = 1; i <= Litters.MAX_CUBS; i++) {
            Litters.attempt(sire, dam, null, false);
        }
        const outcome = Litters.attempt(sire, dam, null, false);
        expect(outcome.litter).toBeNull();
        const body = scalar('SELECT body FROM game_notifications WHERE anthro_id = ? AND read_at IS NULL', [dam.id]);
        expect(body.startsWith("You were bred with Rex: no cub from this one (Fay litter full), but you're expecting a litter of 8, due")).toBe(true);
        expect(scalar('SELECT body FROM game_notifications WHERE anthro_id = ? AND read_at IS NULL', [sire.id]))
            .toBe('You were bred with Fay: no cub from this one (Fay litter full), but Fay is expecting a litter of 8.');
    });

    test('decline and withdraw', () => {
        const alice = player('alice');
        const bob = player('bobby');
        playerAnthro(alice, { name: 'Mack' });
        const fern = playerAnthro(bob, { name: 'Fern', gender: 'Female' });
        Socials.flirt(alice, fern.id, '');
        let id = Number(Socials.forAnthro(fern.id)[0].id);
        expect(Socials.respond(bob, id, false)).toBeNull();
        expect(Socials.find(id)!.status).toBe('declined');
        expect(notificationsFor(Number(Wallets.anthroFor(alice.id)))).toContain('Fern turned down your flirt.');
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings'))).toBe(0);

        Socials.flirt(alice, fern.id, '');
        id = Number(Socials.forAnthro(fern.id)[0].id);
        expect(Socials.withdraw(bob, id)).toBe('That flirt has already been answered.'); // Only the sender takes it back.
        expect(Socials.withdraw(alice, id)).toBeNull();
        expect(Socials.find(id)!.status).toBe('withdrawn');
    });

    test('unplayed anthros answer for themselves', () => {
        const alice = player('alice');
        playerAnthro(alice, { name: 'Mack' });
        const answers = new Set<string>();
        for (let i = 0; i < 30; i++) {
            const [result, error] = Socials.flirt(alice, anthro({ gender: 'Female' }).id, '');
            expect(error).toBeNull();
            answers.add(result!);
        }
        expect(sorted(answers)).toEqual(sorted(['accepted', 'declined'])); // Sometimes yes, sometimes no.
        expect(Number(scalar("SELECT COUNT(*) FROM game_flirts WHERE status = 'pending'"))).toBe(0);
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings'))) // Every yes tries breeding.
            .toBe(Number(scalar("SELECT COUNT(*) FROM game_flirts WHERE status = 'accepted'")));
    });

    test("a pair that can't breed is recorded with no litter", () => {
        const alice = player('alice');
        const bob = player('bobby');
        playerAnthro(alice, { name: 'Mack', gender: 'Male' });
        const moss = playerAnthro(bob, { name: 'Moss', gender: 'Male' });
        Socials.flirt(alice, moss.id, '');
        Socials.respond(bob, Number(Socials.forAnthro(moss.id)[0].id), true);
        const flirt = Socials.forAnthro(moss.id)[0];
        expect(flirt.litter).toBe(0);
        expect(flirt.barren_reason).toBe("Moss can't be a dam (Male)");
    });

    test('no flirting with anthros up for auction', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const seller = player('seller');
        const lot = anthro({ owner: seller, name: 'Lot' });
        Auctions.create(lot, seller.id, 5, null, 1);
        expect(Socials.flirt(alice, lot.id, '')).toEqual([null, 'Lot is up for auction.']);
    });
});
