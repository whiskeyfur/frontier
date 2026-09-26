// Upstream: tests/Game/RanksTest.php
import { describe, expect, test } from 'vitest';
import { gmdate, range } from '../../src/core/php';
import { Anthros } from '../../src/game/Anthros';
import { Baronies } from '../../src/game/Baronies';
import { Ranks, type CourtNode } from '../../src/game/Ranks';
import {
    admin, anthro, anthroOf, db, notificationsFor, notificationsForUser, player, playerAnthro, refresh, scalar, sorted,
} from '../TestCase';

describe('Ranks', () => {
    const lot = (anthroId: number, acres: number) => {
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, ?)', [anthroId, acres]);
    };

    test('of and titles', () => {
        const alice = player('alice');
        expect(Ranks.of(anthro())).toBe(Ranks.COMMONER);
        expect(Ranks.of(anthro({ owner: alice }))).toBe(Ranks.SLAVE);
        expect(Ranks.of(anthro({ title_rank: 4 }))).toBe(4);
        expect(Ranks.of(anthro({ title_rank: 4, owner: alice })), 'Slaves have no title.').toBe(Ranks.SLAVE);
        expect(Ranks.title(anthro({ title_rank: 4, gender: 'Female' }))).toBe('Baroness');
        expect(Ranks.name(4, 'androgynous')).toBe('Baron');
        expect(Ranks.name(Ranks.KING, 'female')).toBe('Queen');
        expect(Ranks.name(Ranks.KNIGHT, 'female')).toBe('Dame');
        expect(Ranks.name(Ranks.SLAVE)).toBe('Slave');
    });

    test('seeded flags', () => {
        expect(Ranks.isNoble(Ranks.KING) && Ranks.isHereditary(Ranks.KING)).toBe(true);
        expect(Ranks.isNoble(4) && Ranks.isHereditary(4), 'Barons are peers.').toBe(true);
        expect(Ranks.isNoble(3), 'A baronet is not a noble...').toBe(false);
        expect(Ranks.isHereditary(3), '...but the title is hereditary.').toBe(true);
        expect(Ranks.isNoble(Ranks.KNIGHT) || Ranks.isHereditary(Ranks.KNIGHT), 'A knight is neither.').toBe(false);
        expect(Ranks.isNoble(Ranks.COMMONER) || Ranks.isHereditary(Ranks.SLAVE)).toBe(false);
        expect([...Ranks.titles().keys()]).toEqual([9, 8, 7, 6, 5, 4, 3, 2]);
    });

    test('update', () => {
        expect(Ranks.update(Ranks.KNIGHT, ' Paladin ', '', true, true)).toBeNull();
        expect(Ranks.name(Ranks.KNIGHT, 'female'), 'An empty female title is the same as the title.').toBe('Paladin');
        expect(Ranks.isNoble(Ranks.KNIGHT) && Ranks.isHereditary(Ranks.KNIGHT)).toBe(true);
        expect(Ranks.title(anthro({ title_rank: Ranks.KNIGHT }))).toBe('Paladin');

        expect(Ranks.update(Ranks.COMMONER, 'Freefolk', 'Freefolk', true, true)).toBeNull();
        expect(Ranks.isNoble(Ranks.COMMONER) || Ranks.isHereditary(Ranks.COMMONER), 'Commoners are never either.').toBe(false);

        expect(Ranks.update(4, 'duke', 'Baroness', true, true)).toBe('Duke already uses that title.');
        expect(Ranks.update(4, ' ', '', true, true)).toBe('Give the rank a title of up to 40 characters.');
        expect(Ranks.update(42, 'X', 'Y', false, false)).toBe('No such rank.');
        expect(Ranks.name(4)).toBe('Baron');
    });

    test('hereditary titles pass to the eldest free child', () => {
        const alice = player('alice');
        const liege = anthro({ title_rank: 6 });
        const baron = anthro({ name: 'Old', title_rank: 4, liege_id: liege.id });
        const follower = anthro({ liege_id: baron.id });
        anthro({ name: 'Owned', sire_id: baron.id, birthdate: '2025-01-01', owner: alice });
        anthro({ name: 'Eldest', sire_id: baron.id, birthdate: '2025-02-01', title_rank: 5 });
        let heir = anthro({ name: 'Heir', dam_id: baron.id, birthdate: '2025-03-01', title_rank: Ranks.KNIGHT });
        anthro({ name: 'Young', sire_id: baron.id, birthdate: '2025-04-01' });
        expect(Ranks.successor(baron)!.name, 'Free, and not already ranking as high.').toBe('Heir');
        expect(Ranks.holders(4).map((h) => h.successor).filter((s) => s).map((s) => s.name)).toEqual(['Heir']);

        db().run('UPDATE game_anthros SET owner_id = ? WHERE id = ?', [liege.id, baron.id]);
        expect(Ranks.strip(baron)!.id).toBe(heir.id);
        heir = refresh(heir);
        expect(heir.title_rank).toBe(4);
        expect(heir.liege_id, 'The liege comes with the title.').toBe(liege.id);
        expect(refresh(follower).liege_id, 'So do the followers.').toBe(heir.id);
        expect(refresh(baron).title_rank).toBeNull();
        expect(notificationsFor(heir.id)).toContain('Old lost their freedom, and you inherited their title: you are Baron now.');
    });

    test('other titles are lost', () => {
        const knight = anthro({ title_rank: Ranks.KNIGHT });
        const child = anthro({ sire_id: knight.id });
        expect(Ranks.strip(knight), "A knighthood isn't hereditary.").toBeNull();
        expect(refresh(child).title_rank).toBeNull();
    });

    test("the crown passes to the monarch's eldest", () => {
        const king = anthro({ title_rank: Ranks.KING });
        const queen = anthro({ gender: 'Female', spouse_of: king.id });
        anthro({ name: 'Princess', sire_id: king.id, gender: 'Female', birthdate: '2025-02-01' });
        anthro({ name: 'Prince', sire_id: king.id, birthdate: '2025-03-01' });
        expect(Ranks.successor(king)!.name, 'One monarch: the eldest, whoever they are.').toBe('Princess');
        expect(Ranks.successor(refresh(queen)), 'A consort has no title of its own to pass on.').toBeNull();
    });

    test('grant by admins', () => {
        const boss = admin();
        let a = anthro({ name: 'Fenn' });
        expect(Ranks.grant(boss, a.id, 5)).toBeNull();
        a = refresh(a);
        expect(a.title_rank).toBe(5);
        expect(a.title_since).not.toBeNull();
        expect(Ranks.grant(boss, a.id, 5)).toBe('Fenn already has that rank.');
        expect(Ranks.grant(boss, a.id, 1)).toBe('Choose a title you can grant.');
        expect(Ranks.grant(boss, 999999, 5)).toBe('Choose an anthro.');
        const slave = anthro({ name: 'Slave', owner: boss });
        expect(Ranks.grant(boss, slave.id, 2)).toBe("Slave can't hold a title: only a free anthro can.");
        expect(Ranks.grant(boss, a.id, null)).toBeNull();
        expect(refresh(a).title_rank).toBeNull();
    });

    test('one king and one queen', () => {
        const boss = admin();
        const king = anthro({ name: 'Rex', gender: 'Male' });
        const queen = anthro({ name: 'Regina', gender: 'Female' });
        const pretender = anthro({ name: 'Pretender', gender: 'Male' });
        expect(Ranks.grant(boss, king.id, Ranks.KING)).toBeNull();
        expect(Ranks.grant(boss, queen.id, Ranks.KING)).toBe('Rex already wears the crown. Take that title away first.');
        expect(Ranks.grant(boss, pretender.id, Ranks.KING)).toBe('Rex already wears the crown. Take that title away first.');
        // His Queen shares it by marriage.
        db().run('UPDATE game_anthros SET spouse_of = ? WHERE id = ?', [king.id, queen.id]);
        expect(Ranks.crown().map((c) => c.id)).toEqual([king.id, queen.id]);
        expect(Ranks.title(refresh(queen))).toBe('Queen');
        expect(Ranks.monarch()!.id).toBe(king.id);
    });

    test('the crown grants titles below its own', () => {
        const alice = player('alice');
        const king = playerAnthro(alice, { title_rank: Ranks.KING, gender: 'Male' });
        const queen = anthro({ title_rank: Ranks.KING, gender: 'Female' });
        const commoner = anthro();
        expect(Ranks.canGrant(alice)).toBe(true);
        expect(Ranks.grantable(alice)).toEqual(range(8, 2));
        expect(Ranks.grant(alice, commoner.id, 8)).toBeNull();
        expect(Ranks.grant(alice, commoner.id, Ranks.KING)).toBe('Choose a title you can grant.');
        expect(Ranks.grant(alice, king.id, null)).toBe("You can't change your own title.");
        expect(Ranks.grant(alice, queen.id, null)).toBe('Only an admin can change the King or Queen.');
        expect(notificationsFor(commoner.id)[0].startsWith('The crown made you Duke')).toBe(true);

        const bob = player('bobby');
        expect(Ranks.canGrant(bob)).toBe(false);
        expect(Ranks.grantable(bob)).toEqual([]);
        expect(Ranks.grant(bob, commoner.id, 2)).toBe('Only the crown can grant titles.');
    });

    test('swear', () => {
        const alice = player('alice');
        const vassal = playerAnthro(alice, { title_rank: Ranks.KNIGHT });
        const baron = anthro({ name: 'Baron', title_rank: 4 });
        const peer = anthro({ name: 'Peer', title_rank: Ranks.KNIGHT });

        expect(Ranks.swear(alice, null)).toBe("You haven't sworn to a liege.");
        expect(Ranks.swear(alice, peer.id), 'A peer will do.').toBeNull();
        expect(refresh(vassal).liege_id).toBe(peer.id);
        expect(Ranks.swear(alice, baron.id)).toBeNull();
        expect(refresh(vassal).liege_id).toBe(baron.id);
        expect(Ranks.swear(alice, baron.id)).toBe("You're already sworn to Baron.");
        expect(Ranks.vassals(baron.id).map((v) => v.id)).toEqual([vassal.id]);
        expect(notificationsFor(baron.id)).toContain(vassal.name + ' swore fealty to you.');
        expect(Ranks.swear(alice, null)).toBeNull();
        expect(refresh(vassal).liege_id).toBeNull();

        const bob = player('bobby');
        playerAnthro(bob, { owner: alice });
        expect(Ranks.swear(bob, baron.id)).toBe('Only an anthro that owns itself can swear to a liege.');
    });

    test('liege links break when ranks change', () => {
        const boss = admin();
        const baron = anthro({ title_rank: 4 });
        const knight = anthro({ title_rank: Ranks.KNIGHT, liege_id: baron.id });
        Ranks.grant(boss, baron.id, Ranks.KNIGHT);
        expect(refresh(knight).liege_id, 'The liege no longer outranks the vassal.').toBeNull();
    });

    test('strip', () => {
        const liege = anthro({ title_rank: 6 });
        let noble = anthro({ title_rank: 4, liege_id: liege.id });
        const vassal = anthro({ title_rank: 2, liege_id: noble.id });
        db().run('UPDATE game_anthros SET owner_id = ? WHERE id = ?', [anthro().id, noble.id]);
        Ranks.strip(noble);
        noble = refresh(noble);
        expect(noble.title_rank).toBeNull();
        expect(noble.liege_id).toBeNull();
        expect(refresh(vassal).liege_id).toBeNull();
    });

    test('heir', () => {
        const knight = anthro({ title_rank: Ranks.KNIGHT });
        expect(Ranks.heir(knight, Ranks.KNIGHT)).toBeNull();
        anthro({ title_rank: 5, title_since: '2025-06-01' });
        const older = anthro({ title_rank: 5, title_since: '2025-01-01' });
        anthro({ title_rank: 8, title_since: '2020-01-01' });
        expect(Ranks.heir(knight, Ranks.KNIGHT)!.id, 'Next rank up held, longest first.').toBe(older.id);
        const liege = anthro({ title_rank: 8 });
        const sworn = anthro({ title_rank: Ranks.KNIGHT, liege_id: liege.id });
        expect(Ranks.heir(sworn, Ranks.KNIGHT)!.id).toBe(liege.id);
    });

    test('nobles', () => {
        const duke = anthro({ name: 'Duke', title_rank: 8 });
        anthro({ name: 'Knight', title_rank: 2, liege_id: duke.id });
        anthro({ name: 'Commoner' });
        const nobles = Ranks.titled();
        expect(nobles.map((n) => n.name)).toEqual(['Duke', 'Knight']);
        expect(Number(nobles[0].vassals)).toBe(1);
        expect(nobles[1].liege_name).toBe('Duke');
    });

    test('create court', () => {
        expect(Ranks.createCourt()).toBe(256);
        const counts = db().pairs('SELECT title_rank, COUNT(*) FROM game_anthros GROUP BY title_rank ORDER BY title_rank DESC');
        expect([...counts], 'The Queen is his consort.').toEqual([[9, 1], [8, 2], [7, 4], [6, 8], [5, 16], [4, 32], [3, 64], [2, 128], [null, 1]]);
        const crown = Ranks.crown();
        expect(crown.map(Ranks.title)).toEqual(['King', 'Queen']);
        expect(Number(scalar(
            `SELECT COUNT(*) FROM game_anthros v LEFT JOIN game_anthros l ON l.id = v.liege_id
             WHERE v.title_rank < 9 AND (l.id IS NULL OR l.title_rank <> v.title_rank + 1)`,
        )), 'Every noble below the crown is sworn to one of the rank above.').toBe(0);
        expect(Number(scalar('SELECT COUNT(*) FROM game_anthros WHERE owner_id <> id OR owner_id IS NULL OR player_id IS NOT NULL')),
            'Every noble is free (owns itself) and unplayed.').toBe(0);
        expect(Anthros.isFree(crown[0])).toBe(true);
    });

    test('everyone is sworn to someone', () => {
        const alice = player('alice');
        const baron = anthro({ name: 'Baron', title_rank: 4 });
        const knights = [anthro({ name: 'K1', title_rank: 2 }), anthro({ name: 'K2', title_rank: 2 })];
        const commoners = [];
        for (let i = 0; i < 4; i++) {
            commoners.push(anthro({ name: `C${i}` }));
        }
        const playerCommoner = playerAnthro(alice);
        const owned = anthro({ owner_id: commoners[0].id });
        const gameStock = anthro({ owner_id: null });

        expect(Ranks.assignLieges()).toBe(5);
        const loads = new Map<number, number>();
        for (const commoner of [...commoners, playerCommoner]) {
            const liege = refresh(commoner).liege_id;
            expect(knights.map((k) => k.id), 'Commoners swear to the lowest nobles held.').toContain(liege);
            loads.set(liege, (loads.get(liege) ?? 0) + 1);
        }
        expect(sorted(loads.values()), 'Spread evenly.').toEqual(sorted([2, 3]));
        expect(refresh(owned).liege_id, 'Owned: sworn to its owner.').toBe(commoners[0].id);
        expect(refresh(gameStock).liege_id).toBeNull();
        expect(refresh(baron).liege_id, 'Nobles may stay unsworn.').toBeNull();
        expect(notificationsFor(playerCommoner.id)[0].startsWith('You are sworn to Knight K')).toBe(true);
        expect(Ranks.assignLieges(), 'Nothing left to do.').toBe(0);
    });

    test('ownership changes move fealty', () => {
        const knight = anthro({ title_rank: 2 });
        const alice = player('alice');
        const commoner = anthro();
        Ranks.assignLieges();
        expect(refresh(commoner).liege_id).toBe(knight.id);
        Anthros.transfer(refresh(commoner), anthroOf(alice), admin().id);
        Ranks.assignLieges();
        expect(refresh(commoner).liege_id, 'Enslaved: now sworn to its owner.').toBe(anthroOf(alice));
    });

    test('commoners of a fallen noble are reassigned', () => {
        const sir = anthro({ name: 'Sir', title_rank: 2 });
        const dame = anthro({ name: 'Dame', title_rank: 2, gender: 'Female' });
        const commoner = anthro({ liege_id: sir.id });
        Ranks.grant(admin(), sir.id, null);
        Ranks.assignLieges();
        expect(refresh(commoner).liege_id).toBe(dame.id);
    });

    test('with no nobles commoners stay unsworn', () => {
        const commoner = anthro();
        expect(Ranks.assignLieges()).toBe(0);
        expect(refresh(commoner).liege_id).toBeNull();
    });

    test("commoners can't renounce but nobles can", () => {
        const alice = player('alice');
        const knight = anthro({ title_rank: 2 });
        const commoner = playerAnthro(alice, { liege_id: knight.id });
        expect(Ranks.swear(alice, null)).toBe('Commoners are always sworn to a noble. Choose another liege instead.');
        expect(refresh(commoner).liege_id).toBe(knight.id);
        db().run('UPDATE game_anthros SET title_rank = 2 WHERE id = ?', [commoner.id]);
        db().run('UPDATE game_anthros SET title_rank = 4 WHERE id = ?', [knight.id]);
        expect(Ranks.swear(alice, null)).toBeNull();
    });

    test('sworn is split into vassals, followers and slaves', () => {
        const baron = anthro({ name: 'Baron', title_rank: 4 });
        anthro({ name: 'Knight', title_rank: 2, liege_id: baron.id });
        anthro({ name: 'Folk', liege_id: baron.id });
        anthro({ name: 'Serf', owner_id: baron.id });
        Ranks.assignLieges();
        const sworn = Ranks.sworn(baron.id);
        expect(sworn.vassals.map((a) => a.name)).toEqual(['Knight']);
        expect(sworn.followers.map((a) => a.name)).toEqual(['Folk']);
        expect(sworn.slaves.map((a) => a.name)).toEqual(['Serf']);
        expect(Ranks.sworn(anthro().id)).toEqual({ vassals: [], followers: [], children: [], slaves: [] });
    });

    test('structure', () => {
        const king = anthro({ name: 'Rex', title_rank: Ranks.KING, title_since: '2025-01-01' });
        const queen = anthro({ name: 'Regina', gender: 'Female', title_rank: Ranks.KING, title_since: '2025-01-02' });
        const duke = anthro({ name: 'Duke', title_rank: 8, liege_id: king.id });
        const knight = anthro({ name: 'Squire', title_rank: 2, liege_id: duke.id });
        const loner = anthro({ name: 'Loner', title_rank: 4 });
        for (const liege of [duke, duke, knight]) {
            anthro({ liege_id: liege.id });
        }
        anthro({ name: 'Unsworn' });
        anthro({ owner: player('alice'), liege_id: duke.id });

        const court = Ranks.structure();
        expect(court.roots.map((n) => n.name)).toEqual(['Rex', 'Regina', 'Loner']);
        const rex = court.roots[0];
        expect(rex.children.map((n) => n.name)).toEqual(['Duke']);
        expect(rex.children[0].commoners, 'Only free, untitled anthros count; the slave does not.').toBe(2);
        expect(rex.children[0].children.map((n) => n.name)).toEqual(['Squire']);
        expect(rex.children[0].children[0].commoners).toBe(1);
        expect(rex.branchCommoners, "The whole branch: the duke's two and the knight's one.").toBe(3);
        expect(rex.children[0].branchCommoners).toBe(3);
        expect([...court.ranks]).toEqual([[9, 2], [8, 1], [4, 1], [2, 1]]);
        expect(court.sworn).toBe(3);
        expect(court.unsworn, "Unsworn, and alice's own anthro (free, no liege).").toBe(2);
        expect(court.roots[2].id).toBe(loner.id);
        expect(court.roots[1].id).toBe(queen.id);
        expect(court.owned).toBe(1);
    });

    test('structure of a full court', () => {
        Ranks.createCourt();
        const court = Ranks.structure();
        expect(court.roots, 'King and Queen.').toHaveLength(2);
        const count = (nodes: CourtNode[]): number => nodes.reduce((sum, n) => sum + 1 + count(n.children), 0);
        expect(count(court.roots), 'Every noble appears once.').toBe(256);
    });

    test("a court's commoners", () => {
        Ranks.createCourt();
        Baronies.createForCourt();
        const created = Ranks.createCommoners();
        const counts = db().all(
            `SELECT n.title_rank, COUNT(c.id) FROM game_anthros n LEFT JOIN game_anthros c ON c.liege_id = n.id AND c.title_rank IS NULL
             WHERE n.title_rank IS NOT NULL GROUP BY n.id`,
        ).map((row) => Object.values(row));
        for (const [rank, count] of counts) {
            // Knights and baronets have their settlements' people instead (none on an expanse).
            if (Number(rank) >= Baronies.HOLDER_RANK) {
                expect(count >= 1 && count <= 3, `A lord has 1-3 commoners, not ${count}.`).toBe(true);
            }
        }
        expect(created, "Baronets get their villages', towns' and cities' people.").toBeGreaterThan(5000);
        expect(Number(scalar(
            'SELECT COUNT(*) FROM game_anthros WHERE title_rank IS NULL AND spouse_of IS NULL AND (owner_id <> id OR player_id IS NOT NULL OR liege_id IS NULL)',
        )), 'All free, unplayed and sworn.').toBe(0);
        expect(Number(scalar(
            `SELECT COUNT(*) FROM game_anthros a JOIN game_genders g ON g.id = a.gender_id JOIN game_names n ON n.name = a.name
             WHERE (g.presents_as = 'male' AND NOT n.is_male) OR (g.presents_as = 'female' AND NOT n.is_female)`,
        )), 'Names fit how they present.').toBe(0);
        expect(Number(scalar('SELECT COUNT(DISTINCT name) FROM game_anthros WHERE title_rank IS NULL')),
            'Fresh names are used before any repeat.').toBeGreaterThan(300);
        expect(Ranks.assignLieges(), 'Already sworn; nobody reassigned.').toBe(0);
        expect(Number(scalar(
            'SELECT COUNT(*) FROM game_anthros WHERE birthdate > SUBDATE(UTC_DATE(), 12 * 7) OR birthdate < SUBDATE(UTC_DATE(), 40 * 7)',
        )), 'Grown, with most of life ahead.').toBe(0);
    });

    test('no commoners without nobles', () => {
        expect(Ranks.createCommoners()).toBe(0);
    });

    test('create court needs species', () => {
        db().exec('PRAGMA foreign_keys = OFF');
        db().exec('DELETE FROM game_species');
        db().exec('PRAGMA foreign_keys = ON');
        expect(Ranks.createCourt()).toBe(0);
    });

    test('land earns ranks', () => {
        expect(new Map(range(3, 8).map((r) => [r, Ranks.acresFor(r)]))).toEqual(
            new Map([[3, 500], [4, 1500], [5, 4500], [6, 13500], [7, 40500], [8, 121500]]));
        expect(Ranks.acresFor(Ranks.KNIGHT)).toBeNull();
        expect(Ranks.acresFor(Ranks.KING), 'The crown too.').toBe(364500);

        const boss = admin();
        const alice = player('alice');
        const me = playerAnthro(alice);
        lot(me.id, 300);
        expect(Ranks.assumable(me)).toBeNull();
        expect(Ranks.assume(alice)).toBe('It takes 500 acres of land to become Baronet (with your household and those sworn to you, you hold 300 acres).');
        lot(me.id, 200);
        expect(Ranks.assumable(me)).toBe(Ranks.BARONET);
        expect(Ranks.assume(alice)).toBeNull();
        expect(refresh(me).title_rank).toBe(Ranks.BARONET);
        expect(notificationsForUser(boss.id)).toContain(`${me.name} took up the rank of Baronet.`);
        expect(Ranks.assume(alice)).toBe('It takes 1,500 acres of land to become Baron (with your household and those sworn to you, you hold 500 acres).');

        // As many as have the land hold each rank; land enough for several ranks earns the highest.
        anthro({ title_rank: 5 });
        lot(me.id, 4000);
        expect(Ranks.assumable(refresh(me)), 'Viscount, though there is one already.').toBe(5);

        // A knight rises by land too, but not a slave.
        const knight = anthro({ title_rank: Ranks.KNIGHT });
        lot(knight.id, 500);
        expect(Ranks.assumable(knight)).toBe(Ranks.BARONET);
        const slave = anthro({ owner: alice });
        lot(slave.id, 1000);
        expect(Ranks.assumable(slave)).toBeNull();
    });

    test('the land of those sworn counts', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        lot(me.id, 350);
        const friends: Record<string, any> = {};
        for (const [name, acres] of [['bobby', 100], ['carol', 50]] as const) {
            const u = player(name);
            friends[name] = playerAnthro(u);
            lot(friends[name].id, acres);
            expect(Ranks.swear(u, me.id), 'A commoner can swear to a fellow commoner.').toBeNull();
        }
        // One sworn to a friend counts too; slaves have no land, and the dead don't count.
        const dave = player('dave');
        playerAnthro(dave);
        lot(anthroOf(dave), 25);
        Ranks.swear(dave, friends.carol.id);
        const dead = anthro({ liege_id: me.id, died_at: gmdate('Y-m-d H:i:s') });
        lot(dead.id, 1000);

        expect(Ranks.acresHeld(me)).toEqual({ own: 350.0, sworn: 175.0, total: 525.0 });
        expect(Ranks.assumable(me)).toBe(Ranks.BARONET);
        expect(Ranks.swear(alice, friends.bobby.id), 'No loops.').toBe('BobbyAnthro is sworn to you.');
        expect(Ranks.assume(alice)).toBeNull();
        Ranks.assignLieges();
        expect(refresh(friends.bobby).liege_id, 'Still sworn to him as a baronet.').toBe(me.id);
        expect(Anthros.findAny(anthroOf(dave))!.liege_id, 'Kept: a fellow commoner.').toBe(friends.carol.id);
        const erin = player('erin');
        playerAnthro(erin, { title_rank: Ranks.KNIGHT });
        expect(Ranks.swear(erin, friends.bobby.id), "A knight can't swear to a commoner.").toBe('Your liege must be of your rank or higher.');
    });

    test('three dukes swearing to a fourth make a king', () => {
        const alice = player('alice');
        const duke = playerAnthro(alice, { title_rank: 8 });
        lot(duke.id, Ranks.acresFor(8)!);
        expect(Ranks.assume(alice)).toBe('It takes 364,500 acres of land to become King (with your household and those sworn to you, you hold 121,500 acres).');
        const peers = [];
        for (const name of ['bobby', 'carol', 'dave']) {
            const u = player(name);
            const peer = playerAnthro(u, { title_rank: 8 });
            peers.push(peer);
            lot(peer.id, Ranks.acresFor(8)!);
            expect(Ranks.swear(u, duke.id), 'A duke swears to a fellow duke.').toBeNull();
        }
        expect(Ranks.swear(alice, peers[0].id), 'No loops.').toBe('BobbyAnthro is sworn to you.');
        expect(Ranks.assumable(duke)).toBe(Ranks.KING);
        expect(Ranks.assume(alice)).toBeNull();
        Ranks.assignLieges();
        expect(Ranks.vassals(duke.id).length, 'His dukes stay sworn to their King.').toBe(3);
        const king = Ranks.structure().roots[0];
        expect([king.id, king.children.length]).toEqual([duke.id, 3]);

        // One monarch by right: another duke, or a duchess, with the land can't take the crown.
        for (const gender of ['Male', 'Female']) {
            const rival = anthro({ title_rank: 8, gender });
            lot(rival.id, Ranks.acresFor(Ranks.KING)!);
            expect(Ranks.assumable(rival)).toBeNull();
        }
        expect(Ranks.assumable(refresh(duke)), 'Nothing above the crown.').toBeNull();
    });

    test('peers sworn to peers build the tree', () => {
        const [a, b, c] = [anthro({ title_rank: 4 }), anthro({ title_rank: 4 }), anthro({ title_rank: 4 })];
        // Sworn in the opposite order to how they're listed (oldest first): c to b, b to a.
        db().run('UPDATE game_anthros SET liege_id = ? WHERE id = ?', [b.id, c.id]);
        db().run('UPDATE game_anthros SET liege_id = ? WHERE id = ?', [a.id, b.id]);
        const roots = Ranks.structure().roots;
        expect(roots.map((n) => n.id)).toEqual([a.id]);
        expect(roots[0].children[0].children[0].id).toBe(c.id);
    });
});
