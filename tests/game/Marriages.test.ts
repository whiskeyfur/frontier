// Upstream: tests/Game/MarriagesTest.php
import { describe, expect, test } from 'vitest';
import type { User } from '../../src/core/Auth';
import { ucfirst } from '../../src/core/php';
import type { Row } from '../../src/db/Db';
import { Marriages } from '../../src/game/Marriages';
import { Ranks } from '../../src/game/Ranks';
import { admin, anthro, db, notificationsFor, player, playerAnthro, refresh } from '../TestCase';

describe('Marriages', () => {
    const lot = (anthroId: number, acres: number): void => {
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, ?)', [anthroId, acres]);
    };

    // A player and the anthro they play.
    const playing = (name: string, fields: Row = {}): [User, Row] => {
        const u = player(name);
        return [u, playerAnthro(u, { name: ucfirst(name), ...fields })];
    };

    const marry = (headUser: User, spouseUser: User, spouse: Row): void => {
        const [said, error] = Marriages.propose(headUser, spouse.id, true);
        expect(error).toBeNull();
        expect(said).toBe(`You proposed to ${spouse.name}.`);
        expect(Marriages.answer(spouseUser, Marriages.proposals(spouse.id).received[0].id, true)).toBeNull();
    };

    test('a pride of queens', () => {
        const [leo, lion] = playing('leo');
        lot(lion.id, 250000);
        const queens: Row[] = [];
        for (const name of ['nala', 'sarabi', 'sarafina']) {
            const [u, lioness] = playing(name, { gender: 'Female' });
            lot(lioness.id, 40000);
            marry(leo, u, lioness);
            queens.push(lioness);
        }
        expect(Marriages.spouses(lion.id).map((s) => s.name)).toEqual(['Nala', 'Sarabi', 'Sarafina']);
        expect(Ranks.acresHeld(lion).total, 'The pride pools its land.').toBe(370000.0);
        expect(Ranks.assume(leo)).toBeNull();
        expect(Ranks.title(refresh(lion))).toBe('King');
        for (let queen of queens) {
            queen = refresh(queen);
            expect([Ranks.title(queen), Ranks.isConsort(queen)], 'All Queens, equal.').toEqual(['Queen', true]);
        }
        expect(Ranks.titled().filter((n) => Number(n.rank) === Ranks.KING).map((n) => n.name)).toEqual(['Leo', 'Nala', 'Sarabi', 'Sarafina']);
        expect([Ranks.monarch()!.id], 'One monarch by right.').toEqual([lion.id]);
    });

    test('leaving costs them both', () => {
        const [rex, kingAnthro] = playing('rex');
        const [regina, queenAnthro] = playing('regina', { gender: 'Female' });
        lot(kingAnthro.id, 250000);
        lot(queenAnthro.id, 130000);
        marry(rex, regina, queenAnthro);
        expect(Ranks.assume(rex), 'Together they have the land for the crown.').toBeNull();
        expect(Ranks.title(refresh(queenAnthro))).toBe('Queen');

        expect(Marriages.leave(regina), "She needs no one's consent.").toBeNull();
        const king = refresh(kingAnthro);
        const queen = refresh(queenAnthro);
        expect(Ranks.title(king), 'Without her land, his falls to what his own earns.').toBe('Duke');
        expect(Ranks.title(queen), 'She never took up a rank of her own.').toBe('Commoner');
        expect(notificationsFor(king.id)).toContain('Regina left your household.');
        expect(notificationsFor(king.id)).toContain('Without the land for it, you are no longer King: you are Duke now.');
        expect(Ranks.assumable(queen), 'Her own land is her own: enough for a duchess.').toBe(8);
    });

    test("granted titles don't hang on land", () => {
        const boss = admin();
        const baron = anthro({ name: 'Granted' });
        Ranks.grant(boss, baron.id, 4);
        expect(Ranks.holdByLand()).toBe(0);
        expect(refresh(baron).title_rank).toBe(4);
    });

    test('a granted title is a floor the crown can revoke', () => {
        const boss = admin();
        const [alice, anthroOfAlice] = playing('alice');
        let me = anthroOfAlice;
        Ranks.grant(boss, me.id, 4);
        lot(me.id, 13500);
        expect(Ranks.assume(alice)).toBeNull();
        me = refresh(me);
        expect([me.title_rank, me.granted_rank], 'Earl by land, over the Baron he was granted.').toEqual([6, 4]);

        db().exec('DELETE FROM game_parcels');
        Ranks.holdByLand();
        me = refresh(me);
        expect([me.title_rank, Number(me.title_by_land), me.granted_rank], 'Down to his grant, no further.').toEqual([4, 0, null]);

        // Risen by land again, the crown revokes the grant: the land's title stays, and no floor is left under it.
        lot(me.id, 4500);
        Ranks.assume(alice);
        expect(Ranks.grant(boss, me.id, null)).toBeNull();
        me = refresh(me);
        expect([me.title_rank, me.granted_rank]).toEqual([5, null]);
        expect(notificationsFor(me.id)).toContain('The crown revoked the title of Baron it granted you: you keep only what your land earns.');
        db().exec('DELETE FROM game_parcels');
        Ranks.holdByLand();
        expect(refresh(me).title_rank, 'Nothing to fall back on.').toBeNull();
    });

    test('a vassal leaving can bring down its lord', () => {
        const [alice, me] = playing('alice');
        const [bob, friend] = playing('bobby');
        lot(me.id, 350);
        lot(friend.id, 150);
        Ranks.swear(bob, me.id);
        Ranks.assume(alice);
        expect(Ranks.title(refresh(me))).toBe('Baronet');
        // Bob swears to another lord instead: his land goes with him.
        expect(Ranks.swear(bob, anthro({ title_rank: Ranks.KNIGHT }).id)).toBeNull();
        expect(Ranks.title(refresh(me))).toBe('Commoner');
    });

    test('who can marry', () => {
        const [alice, me] = playing('alice');
        const [bob, bobs] = playing('bobby');
        const [carol, carols] = playing('carol');
        const slave = anthro({ owner: alice, name: 'Serf' });
        expect(Marriages.propose(alice, slave.id, true)).toEqual([null, "Serf can't marry: only free, grown anthros marry."]);
        expect(Marriages.propose(alice, me.id, true)).toEqual([null, "An anthro can't marry itself."]);
        marry(alice, bob, bobs);
        expect(Marriages.propose(alice, carols.id, false)).toEqual([null, "Alice heads a household, so can't marry into another."]);
        expect(Marriages.propose(carol, bobs.id, true)).toEqual([null, "Bobby is already married, into Alice's household."]);
        expect(Marriages.propose(carol, bobs.id, false)).toEqual([null, "Bobby is married into Alice's household, so can't take spouses."]);

        // Proposals can be taken back, or turned down; a spouse can be sent away.
        expect(Marriages.propose(carol, me.id, true)).toEqual([null, "Alice heads a household, so can't marry into another."]);
        const [, error] = Marriages.propose(alice, carols.id, true);
        expect(error).toBeNull();
        const proposal = Marriages.proposals(carols.id).received[0];
        expect(Marriages.answer(alice, proposal.id, true), 'Not hers to answer.').toBe('That proposal is no longer open.');
        expect(Marriages.answer(carol, proposal.id, false)).toBeNull();
        expect(Marriages.propose(alice, carols.id, true)[1]!.startsWith('Carol turned you down lately: ask again after')).toBe(true);
        expect(Marriages.dismiss(alice, bobs.id)).toBeNull();
        expect(refresh(bobs).spouse_of).toBeNull();
    });

    test('unplayed anthros answer at once', () => {
        const [alice] = playing('alice');
        const answers = new Set<string>();
        for (let i = 0; i < 20; i++) {
            const other = anthro({ gender: 'Female', name: `Maid${i}` });
            const [said] = Marriages.propose(alice, other.id, true);
            answers.add(said === `Maid${i} said no.` ? 'no' : 'yes');
            expect([`Maid${i} said no.`, `Maid${i} said yes: Maid${i} married into your household.`]).toContain(said);
        }
        expect(['no', 'yes'].filter((a) => answers.has(a)), 'Some say yes, some no.').toEqual(['no', 'yes']);
    });

    test('death ends the marriage', () => {
        const [alice, me] = playing('alice');
        const [bob, bobs] = playing('bobby');
        marry(alice, bob, bobs);
        Ranks.strip(refresh(me), 'died');
        expect(refresh(bobs).spouse_of).toBeNull();
        expect(notificationsFor(bobs.id)).toContain('Alice died: your marriage is over.');
    });
});
