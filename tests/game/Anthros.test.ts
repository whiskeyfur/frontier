// Upstream: tests/Game/AnthrosTest.php
import { describe, expect, test } from 'vitest';
import { array_sum, gmdate, strtotimeOrThrow, time } from '../../src/core/php';
import { Anthros } from '../../src/game/Anthros';
import { Auctions } from '../../src/game/Auctions';
import { Litters } from '../../src/game/Litters';
import { Ranks } from '../../src/game/Ranks';
import {
    admin, anthro, anthroOf, coins, db, genderId, notificationsFor, player, playerAnthro, refresh, scalar, setCoins, speciesId,
} from '../TestCase';

describe('Anthros', () => {
    const offDay = () => (Number(gmdate('N')) % 7) + 1;
    const ago = (text: string) => gmdate('Y-m-d', strtotimeOrThrow(text));
    const days = (later: string, earlier: string) => (strtotimeOrThrow(later) - strtotimeOrThrow(earlier)) / 86400;

    // Players and becoming anthros

    test('set player creates a self owned anthro', () => {
        const alice = player('alice');
        const born = ago('-10 weeks');
        expect(Anthros.setPlayer(alice, ' Fenn ', genderId('Male'), speciesId(), born)).toBeNull();
        const p = Anthros.player(alice.id)!;
        expect(p.name).toBe('Fenn');
        expect(p.owner_id, 'Free: it owns itself.').toBe(p.id);
        expect(p.birthdate).toBe(born);
        expect(p.fertile_on).not.toBeNull();
        expect(Anthros.isFree(p)).toBe(true);
        expect(Number(scalar('SELECT COUNT(*) FROM game_ledger WHERE anthro_id = ?', [p.id]))).toBe(1);
    });

    test('set player validates', () => {
        const alice = player('alice');
        const male = genderId('Male');
        expect(Anthros.setPlayer(alice, '', male, speciesId(), '')).toBe('Names must be 1-64 characters.');
        expect(Anthros.setPlayer(alice, 'Fenn', 999999, speciesId(), '')).toBe('Choose a gender.');
        expect(Anthros.setPlayer(alice, 'Fenn', male, 999999, '')).toBe('Choose a species from the list.');
        expect(Anthros.setPlayer(alice, 'Fenn', male, speciesId(), '2025-02-30')).toBe('Enter a valid birthdate.');
        expect(Anthros.setPlayer(alice, 'Fenn', male, speciesId(), ago('-52 weeks')))
            .toBe('Anthros only live about a year: choose a birthdate less than 52 weeks ago.');
        expect(Anthros.setPlayer(alice, 'Fenn', male, speciesId(), '2999-01-01')).toBe('The birthdate cannot be in the future.');
        expect(Anthros.setPlayer(alice, 'Fenn', male, speciesId(), '')).toBeNull();
        const fenn = Anthros.player(alice.id)!;
        expect(fenn.fertile_on, 'No birthdate: just grown, fertile today...').toBe(gmdate('Y-m-d'));
        const d = days(fenn.fertile_on, fenn.birthdate);
        expect(d >= 63 && d <= 84, `...born ${d} days ago, when anthros become fertile.`).toBe(true);
    });

    test('players can only rename once they play', () => {
        const alice = player('alice');
        const born = ago('-10 weeks');
        Anthros.setPlayer(alice, 'Fenn', genderId('Male'), speciesId('Wolf'), born);
        expect(Anthros.setPlayer(alice, 'Fennick', genderId('Female'), speciesId('Lion'), ago('-5 weeks'))).toBeNull();
        const p = Anthros.player(alice.id)!;
        expect(p.name).toBe('Fennick');
        expect(p.gender).toBe('Male');
        expect(p.species).toBe('Wolf');
        expect(p.birthdate).toBe(born);
    });

    test('admins can change everything about their own anthro', () => {
        const boss = admin();
        const born = ago('-30 weeks');
        Anthros.setPlayer(boss, 'Ravnos', genderId('Male'), speciesId('Wolf'), ago('-10 weeks'));
        const before = Anthros.player(boss.id)!;
        expect(Anthros.setPlayer(boss, 'Ravna', genderId('Female'), speciesId('Tiger'), born)).toBeNull();
        const after = Anthros.player(boss.id)!;
        expect([after.name, after.gender, after.species, after.birthdate]).toEqual(['Ravna', 'Female', 'Tiger', born]);
        expect(after.fertile_on).not.toBe(before.fertile_on);
        expect(Anthros.renames(after.id)).toHaveLength(1);
        // Same birthdate: fertility date kept.
        Anthros.setPlayer(boss, 'Ravna', genderId('Female'), speciesId('Tiger'), born);
        expect(Anthros.player(boss.id)!.fertile_on).toBe(after.fertile_on);
    });

    test('become', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const free = anthro({ name: 'Free' });
        const owned = anthro({ name: 'Owned', owner: bob });

        expect(Anthros.become(alice, free.id)).toBeNull();
        const p = Anthros.player(alice.id)!;
        expect(Anthros.isFree(p), 'It stays free.').toBe(true);
        expect(Anthros.become(alice, owned.id)).toBe("You already play an anthro, and that can't be changed.");

        const carol = player('carol');
        expect(Anthros.become(carol, owned.id)).toBeNull();
        expect(Anthros.player(carol.id)!.owner_id, 'An owned anthro keeps its owner.').toBe(anthroOf(bob));
        const dave = player('dave');
        expect(Anthros.become(dave, owned.id)).toBe("That anthro isn't available to become.");
    });

    test('become refuses anthros up for auction and nobles for players', () => {
        const seller = player('seller');
        playerAnthro(seller);
        const lot = anthro({ owner: seller });
        Auctions.create(lot, seller.id, 10, null, 1);
        const baron = anthro({ title_rank: 4 });
        const knight = anthro({ title_rank: Ranks.KNIGHT });

        const alice = player('alice');
        expect(Anthros.become(alice, lot.id)).toBe("That anthro isn't available to become.");
        expect(Anthros.become(alice, baron.id)).toBe("That anthro isn't available to become.");
        expect(Anthros.become(alice, knight.id)).toBeNull();
        expect(Anthros.become(admin(), baron.id)).toBeNull();
    });

    test('available hides nobles from players', () => {
        anthro({ name: 'Commoner' });
        anthro({ name: 'Knight', title_rank: Ranks.KNIGHT });
        anthro({ name: 'Duke', title_rank: 8 });
        const played = player('alice');
        playerAnthro(played);
        expect(Anthros.available().map((a) => a.name)).toEqual(['Commoner', 'Knight']);
        expect(Anthros.available(true).map((a) => a.name)).toEqual(['Commoner', 'Duke', 'Knight']);
    });

    test('players can become titles that are not noble', () => {
        const baronet = anthro({ name: 'Bart', title_rank: 3 });
        expect(Anthros.available().map((a) => a.name), 'A baronet is hereditary, not noble.').toEqual(['Bart']);
        Ranks.update(3, 'Baronet', 'Baronetess', true, true);
        expect(Anthros.available(), 'Made noble: off limits.').toEqual([]);
        expect(Anthros.become(player('alice'), baronet.id)).toBe("That anthro isn't available to become.");
    });

    // Lookups

    test('for owner, find and find any', () => {
        const alice = player('alice');
        const self = playerAnthro(alice);
        const pet = anthro({ name: 'Pet', owner: alice });
        const stranger = anthro();
        expect(Anthros.forOwner(alice.id).map((a) => a.id), 'Players first.').toEqual([self.id, pet.id]);
        expect(Anthros.find(alice.id, pet.id)!.id).toBe(pet.id);
        expect(Anthros.find(alice.id, stranger.id)).toBeNull();
        expect(Anthros.findAny(999999)).toBeNull();
        expect(typeof pet.is_male).toBe('boolean');
    });

    test('all and unowned', () => {
        const alice = player('alice');
        anthro({ name: 'Owned', owner: alice });
        anthro({ name: 'Loose' });
        anthro({ name: 'ForSale', owner_id: null });
        expect(Anthros.all()).toHaveLength(4);
        expect(Anthros.unowned().map((a) => a.name), "Only the game's.").toEqual(['ForSale']);
    });

    test('can view', () => {
        const boss = admin();
        const alice = player('alice');
        expect(Anthros.canView(alice, alice.id)).toBe(true);
        expect(Anthros.canView(alice, 999, alice.id)).toBe(true);
        expect(Anthros.canView(alice, 999, null, alice.id)).toBe(true);
        expect(Anthros.canView(alice, 999, 998, 997)).toBe(false);
        expect(Anthros.canView(alice, null)).toBe(false);
        expect(Anthros.canView(boss, null)).toBe(true);
    });

    test('is free', () => {
        const alice = player('alice');
        const bob = player('bobby');
        expect(Anthros.isFree(anthro()), 'Unowned and unplayed.').toBe(true);
        expect(Anthros.isFree(playerAnthro(alice)), 'Played and self-owned.').toBe(true);
        expect(Anthros.isFree(anthro({ owner: alice }))).toBe(false);
        expect(Anthros.isFree(playerAnthro(bob, { owner: alice }))).toBe(false);
        expect(Anthros.isFree(null)).toBe(false);
        expect(Anthros.isFree(anthro({ owner_id: null })), "The game's.").toBe(false);
    });

    test("free unowned leaves the game's auctions alone", () => {
        const loose = anthro({ owner_id: null });
        const forSale = anthro({ owner_id: null });
        Auctions.create(forSale, null, 5, null, 1);
        expect(Anthros.freeUnowned()).toBe(1);
        expect(Anthros.isFree(refresh(loose))).toBe(true);
        expect(refresh(forSale).owner_id).toBeNull();
    });

    test('free anthros show no owner name', () => {
        const alice = player('alice');
        expect(playerAnthro(alice).owner_name).toBeNull();
        expect(anthro({ owner: alice }).owner_name).toBe('AliceAnthro');
    });

    test('free sql matches is free', () => {
        const alice = player('alice');
        const anthros = [anthro(), playerAnthro(alice), anthro({ owner: alice })];
        for (const a of anthros) {
            const sql = !!scalar('SELECT ' + Anthros.freeSql('x') + ' FROM game_anthros x WHERE x.id = ?', [a.id]);
            expect(sql).toBe(Anthros.isFree(a));
        }
    });

    test('employed by, for hire and find controlled', () => {
        const alice = player('alice');
        const worker = anthro({ name: 'Worker', employer: alice, wage: 10 });
        const seeker = anthro({ name: 'Seeker', wage: 12 });
        anthro({ name: 'Idle' });
        anthro({ name: 'Slave', owner: alice, wage: 5 });
        expect(Anthros.employedBy(alice.id).map((a) => a.name)).toEqual(['Worker']);
        expect(Anthros.forHire().map((a) => a.name)).toEqual(['Seeker']);
        expect(Anthros.findControlled(alice.id, worker.id), 'Hired to work, not to be bred.').toBeNull();
        expect(Anthros.findControlled(alice.id, seeker.id)).toBeNull();
    });

    test('recipients are every anthro', () => {
        playerAnthro(player('alice'), { name: 'Played' });
        anthro({ name: 'Unplayed' });
        expect(Anthros.recipients().map((a) => a.name)).toEqual(['Played', 'Unplayed']);
        expect(Object.keys(Anthros.recipients()[0]), 'Nothing reveals who is played.').toEqual(['id', 'name']);
    });

    test('is owner and is employer', () => {
        const alice = player('alice');
        const self = playerAnthro(alice);
        const pet = anthro({ owner: alice });
        const worker = anthro({ employer: alice });
        const bob = player('bobby');
        expect(Anthros.isOwner(alice, self), 'Her own anthro, while free.').toBe(true);
        expect(Anthros.isOwner(alice, pet)).toBe(true);
        expect(Anthros.isOwner(alice, worker)).toBe(false);
        expect(Anthros.isEmployer(alice, worker)).toBe(true);
        expect(Anthros.isOwner(bob, pet)).toBe(false);
        expect(Anthros.isEmployer(bob, worker)).toBe(false);
        const enslaved = playerAnthro(bob, { owner: alice });
        expect(Anthros.isOwner(bob, enslaved), "A slave doesn't decide for itself.").toBe(false);
        expect(Anthros.isOwner(alice, enslaved)).toBe(true);
        expect(Anthros.canSee(bob, enslaved)).toBe(true);
        expect(Anthros.canSee(alice, worker)).toBe(true);
    });

    // Ages and fertility

    test('age', () => {
        expect(Anthros.ageWeeks(null)).toBeNull();
        expect(Anthros.ageWeeks(gmdate('Y-m-d'))).toBe(0);
        expect(Anthros.ageWeeks(ago('-22 days'))).toBe(3);
        expect(Anthros.age(null)).toBe('unknown');
        expect(Anthros.age(ago('-7 days'))).toBe('1 week');
        expect(Anthros.age(ago('-14 days'))).toBe('2 weeks');
    });

    test('random fertile on is nine to twelve weeks after birth', () => {
        expect(Anthros.randomFertileOn(null)).toBeNull();
        for (let i = 0; i < 30; i++) {
            const d = days(Anthros.randomFertileOn('2025-01-01')!, '2025-01-01');
            expect(d).toBeGreaterThanOrEqual(63);
            expect(d).toBeLessThanOrEqual(84);
        }
    });

    test('is fertile and set fertile on', () => {
        const a = anthro({ fertile_on: '2999-01-01' });
        expect(Anthros.isFertile(a)).toBe(false);
        expect(Anthros.setFertileOn(a, '2025-13-01')).toBe('Enter a valid date.');
        expect(Anthros.setFertileOn(a, '')).toBeNull();
        expect(Anthros.isFertile(refresh(a))).toBe(true);
        expect(Anthros.setFertileOn(a, gmdate('Y-m-d'))).toBeNull();
        expect(Anthros.isFertile(refresh(a))).toBe(true);
    });

    test('weekdays', () => {
        expect(Anthros.weekday(1)).toBe('Monday');
        expect(Anthros.weekday(7)).toBe('Sunday');
        expect(Anthros.weekday(null)).toBe('not set');
        const a = anthro();
        expect(Anthros.setFertileWeekday(a, 0)).toBe('Choose a day of the week.');
        expect(Anthros.setFertileWeekday(a, 8)).toBe('Choose a day of the week.');
        expect(Anthros.setFertileWeekday(a, 5)).toBeNull();
        expect(refresh(a).fertile_weekday).toBe(5);
    });

    test('breeding blocker', () => {
        const male = anthro({ gender: 'Male' });
        const young = anthro({ gender: 'Female', fertile_on: '2999-01-01' });
        expect(Anthros.breedingBlocker(male, 'sire')).toBeNull();
        expect(Anthros.breedingBlocker(male, 'dam')).toBe("can't be a dam (Male)");
        expect(Anthros.breedingBlocker(young, 'sire')).toBe("can't sire (Female)");
        expect(Anthros.breedingBlocker(young, 'dam')).toBe('not fertile until 2999-01-01');
        expect(Anthros.breedingBlocker(young, 'dam', true)).toBeNull();
    });

    test('breeding blocker never reveals the fertile weekday', () => {
        const dam = anthro({ gender: 'Female', fertile_weekday: offDay() });
        expect(Anthros.breedingBlocker(dam, 'dam')).toBeNull();
    });

    test('barren reason', () => {
        const sire = anthro({ gender: 'Male', name: 'Mack' });
        const dam = anthro({ gender: 'Female', name: 'Fern' });
        expect(Anthros.barrenReason(sire, dam)).toBeNull();
        expect(Anthros.barrenReason(dam, sire)).toBe("Fern can't sire (Female)");
        const off = anthro({ gender: 'Female', fertile_weekday: offDay() });
        expect(Anthros.barrenReason(sire, off)).toBe(Anthros.DIDNT_TAKE);
        expect(Anthros.barrenReason(sire, off, true), 'Forced breeding ignores the day.').toBeNull();
        const offDaySire = anthro({ gender: 'Male', fertile_weekday: offDay() });
        expect(Anthros.barrenReason(offDaySire, dam), 'Sires are fertile every day.').toBeNull();
        const noSpecies1 = anthro({ gender: 'Male', species_id: null });
        const noSpecies2 = anthro({ gender: 'Female', species_id: null });
        expect(Anthros.barrenReason(noSpecies1, noSpecies2)).toBe('neither parent has a species for the cubs to inherit');
    });

    // Breeding

    test('breed starts a litter', () => {
        const alice = player('alice');
        const sire = anthro({ owner: alice, gender: 'Male' });
        const dam = anthro({ owner: alice, gender: 'Female' });
        const [outcome, error] = Anthros.breed(alice.id, sire.id, dam.id);
        expect(error).toBeNull();
        expect(outcome!.barren).toBeNull();
        expect(Number(outcome!.litter!.cubs)).toBe(1);
        expect(outcome!.litter!.due_on).toBe(gmdate('Y-m-d', strtotimeOrThrow('+' + Litters.GESTATION_DAYS + ' days')));
        expect(refresh(dam).pregnant_due_on).not.toBeNull();
    });

    test('breed records rule breaking pairs without a litter', () => {
        const alice = player('alice');
        const a = anthro({ owner: alice, gender: 'Male', name: 'Mack' });
        const b = anthro({ owner: alice, gender: 'Male', name: 'Moss' });
        const [outcome, error] = Anthros.breed(alice.id, a.id, b.id);
        expect(error).toBeNull();
        expect(outcome!.litter).toBeNull();
        expect(outcome!.barren).toBe("Moss can't be a dam (Male)");
        const history = Anthros.history(a.id);
        expect(history).toHaveLength(1);
        expect(history[0].barren_reason).toBe("Moss can't be a dam (Male)");
    });

    test('breed refusals', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const mine = anthro({ owner: alice, gender: 'Male' });
        const theirs = anthro({ gender: 'Female' });
        expect(Anthros.breed(alice.id, mine.id, theirs.id)).toEqual([null, 'Choose a sire and a dam from your anthros.']);
        expect(Anthros.breed(alice.id, mine.id, mine.id)).toEqual([null, 'The sire and dam must be different anthros.']);
        const dam = anthro({ owner: alice, gender: 'Female', name: 'Listed' });
        Auctions.create(dam, alice.id, 5, null, 1);
        expect(Anthros.breed(alice.id, mine.id, dam.id)).toEqual([null, 'Listed is up for auction.']);
    });

    test('employers can\'t breed their employees', () => {
        const alice = player('alice');
        const sire = anthro({ owner: alice, gender: 'Male' });
        const employee = anthro({ gender: 'Female', employer: alice });
        expect(Anthros.breed(alice.id, sire.id, employee.id)).toEqual([null, 'Choose a sire and a dam from your anthros.']);
        expect(Anthros.mayBreed(alice, Anthros.findAny(employee.id)!)).toBe(false);
        expect(Anthros.breedable(alice.id).map((a) => a.id)).not.toContain(employee.id);
        // An employee's cubs are her own, however she's bred (she's free).
        Litters.attempt(anthro({ gender: 'Male' }), employee, null, false);
        db().run('UPDATE game_litters SET due_on = UTC_DATE()');
        Litters.deliverDue();
        expect(Number(scalar('SELECT owner_id FROM game_anthros WHERE dam_id = ?', [employee.id]))).toBe(employee.id);
    });

    test('group breed', () => {
        const alice = player('alice');
        const ids: number[] = [];
        for (const gender of ['Male', 'Male', 'Female']) {
            ids.push(anthro({ owner: alice, gender }).id);
        }
        const young = anthro({ owner: alice, gender: 'Female', fertile_on: '2999-01-01', name: 'Young' });
        ids.push(young.id);
        const result = Anthros.groupBreed(alice.id, ids, 2);
        expect(array_sum(Object.values(result.pairs)), 'Two sires, two rounds.').toBe(4);
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings'))).toBe(4);
        const barren = array_sum(Object.values(result.barren));
        const cubs = Number(scalar('SELECT COUNT(*) FROM game_breedings WHERE litter_id IS NOT NULL'));
        expect(barren + cubs).toBe(4);
        for (const line of Object.keys(result.barren)) {
            expect(line).toContain('Young not fertile');
        }
    });

    test('group breed needs both roles', () => {
        const alice = player('alice');
        const a = anthro({ owner: alice, gender: 'Male' });
        const b = anthro({ owner: alice, gender: 'Male' });
        const result = Anthros.groupBreed(alice.id, [a.id, b.id], 1);
        expect(result.skipped).toEqual(['Select at least one anthro that can sire and one that can be a dam.']);
    });

    test('force breed ignores fertility but not roles', () => {
        const boss = admin();
        const alice = player('alice');
        const sire = anthro({ gender: 'Male', fertile_on: '2999-01-01' });
        const dam = anthro({ gender: 'Female', fertile_weekday: offDay() });
        let [outcome, error] = Anthros.forceBreed(sire.id, dam.id, boss.id);
        expect(error).toBeNull();
        expect(outcome!.litter).not.toBeNull();
        [outcome] = Anthros.forceBreed(dam.id, sire.id, boss.id);
        expect(outcome!.litter).toBeNull();
        expect(Anthros.forceBreed(999999, dam.id, boss.id)).toEqual([null, 'Choose a sire and a dam.']);
        expect(Anthros.forceBreed(sire.id, sire.id, boss.id)).toEqual([null, 'The sire and dam must be different anthros.']);
    });

    test('can breed needs another anthro', () => {
        const alice = player('alice');
        const only = playerAnthro(alice);
        expect(Anthros.canBreed(alice.id, only)).toBe(false);
        anthro({ owner: alice, gender: 'Male' });
        expect(Anthros.canBreed(alice.id, only), 'Any partner will do, litter or not.').toBe(true);
    });

    test('sires and dams', () => {
        const male = anthro({ gender: 'Male' });
        const female = anthro({ gender: 'Female' });
        const herm = anthro({ gender: 'Herm' });
        expect(Anthros.sires([male, female, herm]).map((a) => a.id)).toEqual([male.id, herm.id]);
        expect(Anthros.dams([male, female, herm]).map((a) => a.id)).toEqual([female.id, herm.id]);
    });

    test('history lists offspring', () => {
        const alice = player('alice');
        const sire = anthro({ owner: alice, gender: 'Male', name: 'Mack' });
        const dam = anthro({ owner: alice, gender: 'Female', name: 'Fern' });
        Anthros.breed(alice.id, sire.id, dam.id);
        db().run('UPDATE game_litters SET due_on = UTC_DATE()');
        Litters.deliverDue();
        const history = Anthros.history(dam.id);
        expect(history[0].partner_name).toBe('Mack');
        expect(history[0].partner_role).toBe('sire');
        expect(history[0].offspring).toHaveLength(1);
        expect(Anthros.history(anthro().id)).toEqual([]);
    });

    test('every dam stops conceiving 47 to 52 weeks after birth', () => {
        for (let i = 1; i <= 30; i++) {
            const a = anthro({ gender: 'Female' });
            const d = days(a.fertile_until, a.birthdate);
            expect(d).toBeGreaterThanOrEqual(47 * 7);
            expect(d).toBeLessThanOrEqual(52 * 7);
        }
        expect(anthro({ birthdate: null, fertile_on: null }).fertile_until, 'Unknown birthdate: no limit.').toBeNull();
        for (let i = 1; i <= 20; i++) {
            const until = Anthros.randomFertileUntil('2026-01-01')!;
            expect(until >= '2026-11-26' && until <= '2026-12-31', until).toBe(true);
        }
    });

    test("old dams can't conceive", () => {
        const old = ago('-50 weeks');
        const past = ago('-1 day');
        const dam = anthro({ gender: 'Female', birthdate: old, fertile_until: past });
        const herm = anthro({ gender: 'Herm', birthdate: old, fertile_until: past });
        const sire = anthro({ birthdate: old, fertile_until: past });
        expect(Anthros.breedingBlocker(dam, 'dam')).toBe('too old to carry');
        expect(Anthros.breedingBlocker(dam, 'dam', true), 'Admins can force it.').toBeNull();
        expect(Anthros.breedingBlocker(herm, 'dam')).toBe('too old to carry');
        expect(Anthros.breedingBlocker(herm, 'sire'), 'Siring never stops.').toBeNull();
        expect(Anthros.breedingBlocker(sire, 'sire')).toBeNull();
        expect(Anthros.barrenReason(sire, dam)).toBe(`${dam.name} too old to carry`);
        expect([Anthros.fertility(dam), Anthros.fertility(herm), Anthros.fertility(sire)]).toEqual(['no longer', 'sires only', 'yes']);
        const today = anthro({ gender: 'Female', birthdate: old, fertile_until: gmdate('Y-m-d') });
        expect(Anthros.breedingBlocker(today, 'dam'), 'Her last day still counts.').toBeNull();
    });

    test('set fertile until', () => {
        const dam = anthro({ gender: 'Female', birthdate: '2026-01-01', lifespan_weeks: 80 });
        expect(Anthros.setFertileUntil(dam, '2026-12-01')).toBeNull();
        expect(refresh(dam).fertile_until).toBe('2026-12-01');
        const error = 'Fertile until must be 47 to 52 weeks after birth: 2026-11-26 to 2026-12-31.';
        expect(Anthros.setFertileUntil(dam, '2026-11-25')).toBe(error);
        expect(Anthros.setFertileUntil(dam, '2027-01-01')).toBe(error);
        expect(Anthros.setFertileUntil(dam, '')).toBe(error);
        expect(Anthros.setFertileUntil(dam, '2026-12-31')).toBeNull();

        const boss = admin();
        Anthros.setPlayer(boss, 'Ravna', genderId('Female'), speciesId(), ago('-10 weeks'));
        const before = Anthros.player(boss.id)!;
        const born = ago('-20 weeks');
        Anthros.setPlayer(boss, 'Ravna', genderId('Female'), speciesId(), born);
        const after = Anthros.player(boss.id)!;
        const d = days(after.fertile_until, born);
        expect(d >= 47 * 7 && d <= 52 * 7, 'A new birthdate moves it.').toBe(true);
        expect(before.fertile_until).not.toBeNull();
    });

    test('breed several times stops when the litter is full', () => {
        const alice = player('alice');
        const sire = anthro({ owner: alice });
        const dam = anthro({ owner: alice, gender: 'Female', name: 'Brandy' });
        let [outcome] = Anthros.breed(alice.id, sire.id, dam.id, 3);
        expect([outcome!.attempts, outcome!.took, Number(outcome!.litter!.cubs)]).toEqual([3, 3, 3]);
        [outcome] = Anthros.breed(alice.id, sire.id, dam.id, 8);
        expect([outcome!.attempts, outcome!.took, Number(outcome!.litter!.cubs)], 'Stops at a full litter.').toEqual([5, 5, 8]);
        [outcome] = Anthros.breed(alice.id, sire.id, dam.id, 2);
        expect([outcome!.attempts, outcome!.took, outcome!.barren]).toEqual([1, 0, 'Brandy litter full']);
        expect(Anthros.breed(alice.id, sire.id, dam.id, 9)).toEqual([null, 'Breed 1 to 8 times.']);
        expect(Anthros.breed(alice.id, sire.id, dam.id, 0)).toEqual([null, 'Breed 1 to 8 times.']);
    });

    test("breeding stops at the dam's own limit", () => {
        const alice = player('alice');
        const sire = anthro({ owner: alice });
        const dam = anthro({ owner: alice, gender: 'Female', max_cubs: 2 });
        const [outcome] = Anthros.breed(alice.id, sire.id, dam.id, 8);
        expect([outcome!.attempts, outcome!.took, Number(outcome!.litter!.cubs)]).toEqual([2, 2, 2]);
    });

    test('a herm can breed itself', () => {
        const alice = player('alice');
        const herm = playerAnthro(alice, { gender: 'Herm', max_cubs: 3, name: 'Selby' });
        const [outcome, error] = Anthros.selfBreed(alice, herm.id, 5);
        expect(error).toBeNull();
        expect([outcome!.attempts, outcome!.took, Number(outcome!.litter!.cubs)], 'Stops at a full litter.').toEqual([3, 3, 3]);
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings WHERE sire_id = ? AND dam_id = ?', [herm.id, herm.id]))).toBe(3);
        expect(Anthros.selfBreed(alice, herm.id, 9)).toEqual([null, 'Choose a litter of 1 to 8.']);

        const bob = player('bobby');
        const female = playerAnthro(bob, { gender: 'Female' });
        expect(Anthros.selfBreed(bob, female.id, 1)).toEqual([null, 'Only a herm can breed itself.']);
        const carol = player('carol');
        const owned = playerAnthro(carol, { gender: 'Herm', name: 'Owned', owner: alice });
        expect(Anthros.selfBreed(carol, owned.id, 1)).toEqual([null, "Selby decides Owned's breeding."]);
        expect(Anthros.selfBreed(bob, owned.id, 1)).toEqual([null, "That isn't your anthro to breed."]);
        expect(Anthros.selfBreed(alice, owned.id, 1)[1], 'Its owner decides.').toBeNull();
    });

    test('create random makes an unowned fertile adult', () => {
        const a = Anthros.createRandom(speciesId('Lion'));
        expect(a.owner_id).toBeNull();
        expect(a.species).toBe('Lion');
        const weeks = Anthros.ageWeeks(a.birthdate)!;
        expect(weeks).toBeGreaterThanOrEqual(12);
        expect(weeks).toBeLessThanOrEqual(40);
        // Each anthro gets its own lifespan.
        expect(a.lifespan_weeks).toBeGreaterThanOrEqual(Anthros.LIFESPAN_MIN);
        expect(a.lifespan_weeks).toBeLessThanOrEqual(Anthros.LIFESPAN_MAX);
        expect(Anthros.isFertile(a)).toBe(true);
    });

    // Ownership, debts, renames

    test('rename records history', () => {
        const alice = player('alice');
        const a = anthro({ name: 'Old' });
        expect(Anthros.rename(a, 'Old', alice.id)).toBeNull();
        expect(Anthros.renames(a.id), "Unchanged names aren't recorded.").toEqual([]);
        expect(Anthros.rename(a, ' New ', alice.id)).toBeNull();
        expect(refresh(a).name).toBe('New');
        const renames = Anthros.renames(a.id);
        expect([renames[0].old_name, renames[0].new_name, renames[0].renamed_by_name]).toEqual(['Old', 'New', 'alice']);
        expect(Anthros.rename(a, '', alice.id)).toBe('Names must be 1-64 characters.');
    });

    test('transfer gives the anthro to another anthro', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const wren = playerAnthro(bob, { name: 'Wren' });
        let pet = anthro({ owner: alice, name: 'Pet', debt: 100, debt_since: gmdate('Y-m-d H:i:s') });
        const mine = anthroOf(alice);
        expect(Anthros.transfer(pet, 999999, alice.id)).toBe('Choose an anthro to transfer to.');
        expect(Anthros.transfer(pet, mine, alice.id)).toBe('AliceAnthro already owns Pet.');
        expect(Anthros.transfer(pet, pet.id, alice.id)).toBe('Choose another anthro; an anthro that owns itself is free.');
        expect(Anthros.transfer(pet, wren.id, alice.id)).toBeNull();
        pet = refresh(pet);
        expect(pet.owner_id).toBe(wren.id);
        expect(pet.owner_name).toBe('Wren');
        expect(pet.debt, 'A debt was owed to the previous owner.').toBeNull();
        const transfer = Anthros.transfers(pet.id)[0];
        expect([transfer.from_name, transfer.to_name]).toEqual(['AliceAnthro', 'Wren']);
        expect(Number(transfer.by_owner)).toBe(1);
        expect(notificationsFor(wren.id)).toEqual(['AliceAnthro gave Pet to you.']);
    });

    test('giving away a free anthro hands over its anthros', () => {
        const alice = player('alice');
        const self = playerAnthro(alice, { title_rank: 4 });
        const pet = anthro({ owner: alice, name: 'Pet' });
        const master = anthro({ name: 'Master' });
        expect(Anthros.transfer(self, master.id, alice.id)).toBeNull();
        expect(refresh(self).owner_id).toBe(master.id);
        expect(refresh(pet).owner_id, 'Its anthros go to its new owner.').toBe(master.id);
        expect(refresh(self).title_rank, 'And it loses its title.').toBeNull();
        expect(Anthros.isOwner(alice, refresh(self))).toBe(false);
    });

    test('an anthro sold to its own slave frees the slave', () => {
        const alice = player('alice');
        const self = playerAnthro(alice);
        const pet = anthro({ owner: alice, name: 'Pet' });
        expect(Anthros.transfer(self, pet.id, alice.id)).toBeNull();
        expect(refresh(self).owner_id).toBe(pet.id);
        expect(Anthros.isFree(refresh(pet)), 'Its new owner was its own anthro, which goes free.').toBe(true);
    });

    test('transfer refuses anthros up for auction', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const pet = anthro({ owner: alice, name: 'Pet' });
        Auctions.create(pet, alice.id, 5, null, 1);
        expect(Anthros.transfer(refresh(pet), anthroOf(player('bobby')), alice.id)).toBe('Pet is up for auction.');
    });

    test('debt accrues daily', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const slave = playerAnthro(bob, { owner: alice });
        expect(Anthros.setDebt(slave, 'abc', 0)).toBe('The debt must be a whole number of coins (at least 1), or empty for no debt.');
        expect(Anthros.setDebt(slave, '0', 0)).toBe('The debt must be a whole number of coins (at least 1), or empty for no debt.');
        expect(Anthros.setDebt(slave, '10', -1)).toBe("The daily increase can't be negative.");
        expect(Anthros.setDebt(slave, '300', 10)).toBeNull();
        expect(Number(refresh(slave).debt)).toBe(300);
        // Upstream: debt_since = UTC_TIMESTAMP() - INTERVAL 3 DAY - INTERVAL 2 HOUR.
        db().run('UPDATE game_anthros SET debt_since = ? WHERE id = ?', [gmdate('Y-m-d H:i:s', time() - 3 * 86400 - 2 * 3600), slave.id]);
        expect(Number(refresh(slave).debt)).toBe(330);
        expect(notificationsFor(slave.id)[0].startsWith('Your owner set your debt to 300 coins')).toBe(true);
        expect(Anthros.setDebt(slave, '', 0)).toBeNull();
        expect(refresh(slave).debt).toBeNull();
    });

    test('buy freedom', () => {
        const alice = player('alice');
        const owner = playerAnthro(alice);
        const bob = player('bobby');
        let slave = playerAnthro(bob, { owner: alice });

        expect(Anthros.buyFreedom(bob)).toBe("Your owner hasn't set a debt, so you can't buy your freedom.");
        Anthros.setDebt(slave, '100', 0);
        expect(Anthros.buyFreedom(bob)).toBe('You need 100 coins but have 0 coins.');
        setCoins(slave.id, 150);
        expect(Anthros.buyFreedom(bob)).toBeNull();

        slave = refresh(slave);
        expect(slave.owner_id, 'It owns itself.').toBe(slave.id);
        expect(slave.debt).toBeNull();
        expect(Anthros.isOwner(bob, slave)).toBe(true);
        expect(coins(slave.id)).toBe(50);
        expect(coins(owner.id)).toBe(100);
        expect(Anthros.transfers(slave.id)[0].to_owner_id).toBe(slave.id);
        expect(Anthros.buyFreedom(bob)).toBe('You already own yourself.');
        expect(Anthros.buyFreedom(player('carol'))).toBe("You don't play an anthro.");
    });

    test('an unplayed owner is paid too', () => {
        const master = anthro({ name: 'Master' });
        const bob = player('bobby');
        const slave = playerAnthro(bob, { owner_id: master.id });
        Anthros.setDebt(slave, '5', 0);
        setCoins(slave.id, 5);
        expect(Anthros.buyFreedom(bob)).toBeNull();
        expect(coins(master.id)).toBe(5);
        expect(notificationsFor(master.id)).toContain('BobbyAnthro paid their debt of 5 coins and is now free.');
    });
});
