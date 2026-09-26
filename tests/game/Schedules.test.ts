// Upstream: tests/Game/SchedulesTest.php
import { describe, expect, test } from 'vitest';
import { gmdate, int, range, strtotimeOrThrow } from '../../src/core/php';
import type { Row } from '../../src/db/Db';
import { Anthros } from '../../src/game/Anthros';
import { Auctions } from '../../src/game/Auctions';
import { Buildings } from '../../src/game/Buildings';
import { Goods } from '../../src/game/Goods';
import { Groups } from '../../src/game/Groups';
import { Land } from '../../src/game/Land';
import { Litters } from '../../src/game/Litters';
import { Schedules } from '../../src/game/Schedules';
import {
    admin, anthro, anthroOf, baronyId, coins, db, notificationsFor, player, playerAnthro, refresh, scalar, setCoins,
} from '../TestCase';

describe('Schedules', () => {
    const skillId = (name: string): number => Number(scalar('SELECT id FROM game_skills WHERE name = ?', [name]));

    const occupationId = (title: string, skill: string | null = null): number => Number(scalar(
        'SELECT o.id FROM game_occupations o JOIN game_skills s ON s.id = o.skill_id WHERE o.title = ? AND s.name = COALESCE(?, s.name) ORDER BY o.id LIMIT 1',
        [title, skill],
    ));

    /**
     * Every day of the week set to activity with detail (see Schedules::setWeekly).
     */
    const everyDay = (activity: string, detail = ''): Record<number, Row> => {
        const days: Record<number, Row> = {};
        for (let day = 1; day <= 7; day++) {
            days[day] = { activity, detail };
        }
        return days;
    };

    /**
     * A day's practice at the skill, so the anthro can work at its occupations.
     */
    const learn = (a: Row, skill: string): void => {
        db().run('INSERT INTO game_anthro_skills (anthro_id, skill_id, practice) VALUES (?, ?, 1)', [a.id, skillId(skill)]);
    };

    /** strtotime('next wednesday'), as a date: the first Wednesday after today. */
    const nextWednesday = (): string => {
        const n = int(gmdate('N'));
        return gmdate('Y-m-d', strtotimeOrThrow('today') + (((3 - n + 7) % 7) || 7) * 86400);
    };

    test('train first then work', () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { name: 'Me' });
        const baker = occupationId('Baker');
        expect(Schedules.options(alice, me).learned).not.toContain(skillId('Cooking'));
        expect(Schedules.planDay(alice, me, gmdate('Y-m-d'), 'work', 'o:' + baker), 'It can be planned ahead of the training.').toBeNull();
        Schedules.runToday();
        expect(Schedules.log(me.id)[0].outcome).toBe("Meant to work as Baker, but hasn't trained at Cooking yet: rested.");
        expect(coins(me.id), 'No pay.').toBe(0);
        expect(Schedules.skillsOf(me.id), 'And nothing learned.').toEqual([]);

        // A day's training, and it can work as a Baker.
        learn(me, 'Cooking');
        expect(Schedules.options(alice, me).learned).toContain(skillId('Cooking'));
        db().exec('DELETE FROM game_schedule_log');
        db().exec("DELETE FROM game_daily WHERE task = 'schedules'");
        Schedules.runToday();
        expect(Schedules.log(me.id)[0].outcome).toBe('Worked as Baker (Cooking: Novice), earning 2 coins.');
    });

    test('anthros that keep themselves live by a trade', () => {
        db().exec("DELETE FROM game_daily WHERE task = 'defaults'");
        let baker = anthro({ name: 'Baker' });
        setCoins(baker.id, 20);
        db().run("UPDATE game_goods SET quantity = 2 WHERE anthro_id = ? AND good = 'food'", [baker.id]);
        const alice = player('alice');
        const played = playerAnthro(alice);
        const planned = anthro({ name: 'Planned' });
        Schedules.setWeekly(admin(), planned, { ...everyDay('rest'), 1: { activity: 'work', detail: 'f' } });
        const slave = anthro({ owner: alice });

        expect(Schedules.runDefaults()).toBeGreaterThanOrEqual(1);
        expect(Schedules.runDefaults(), 'Once a day.').toBe(0);
        baker = refresh(baker);
        const trade = Schedules.tradeOf(baker)!;
        expect(baker.trade_occupation_id, 'A trade of its own...').toBe(trade.id);
        expect(Schedules.learned(baker.id), '...that it knows.').toContain(trade.skill_id);
        expect(Schedules.log(baker.id)[0].outcome.startsWith(`Worked as ${trade.title}`)).toBe(true);
        expect(Goods.amount(baker.id), 'It buys toward a week\'s food...').toBeLessThanOrEqual(Schedules.INDEPENDENT_FOOD_DAYS);
        expect(Schedules.log(baker.id)[0].outcome, '...with what it earns.').toContain('Bought ');
        for (const other of [played, planned, slave]) {
            expect(refresh(other).trade_occupation_id, 'Played, planned or owned: not on its own.').toBeNull();
        }
    });

    test('their routine is their trade as journeymen', () => {
        const smith = anthro({ name: 'Smith' });
        const trade = Schedules.tradeOf(smith)!;
        expect(Schedules.level(Schedules.skillsOf(smith.id)[0].practice), 'A Journeyman at it.').toBe('Journeyman');
        const week = Schedules.weekly(smith.id);
        expect(Object.values(week).map((d) => [d.activity, d.occupation_id]), 'Working it every day.').toEqual(Array(7).fill(['work', trade.id]));
        expect(Schedules.upcoming(refresh(smith), 1)[gmdate('Y-m-d')].source).toBe('routine');

        // More practice already is kept; a routine of its own replaces the trade's.
        db().run('UPDATE game_anthro_skills SET practice = 90 WHERE anthro_id = ?', [smith.id]);
        Schedules.tradeOf(refresh(smith));
        expect(Schedules.skillsOf(smith.id)[0].practice).toBe(90);
        Schedules.setWeekly(admin(), refresh(smith), { ...everyDay('rest'), 2: { activity: 'work', detail: 'f' } });
        expect([Schedules.weekly(smith.id)[1].activity, Schedules.weekly(smith.id)[2].activity]).toEqual(['rest', 'forage']);
    });

    test('default days by age', () => {
        db().exec("DELETE FROM game_daily WHERE task = 'defaults'");
        const alice = player('alice');
        const baker = occupationId('Baker');
        const smith = occupationId('Blacksmith');
        const mom = anthro({ owner: alice, gender: 'Female', name: 'Mom', trade_occupation_id: baker });
        const dad = anthro({ owner: alice, name: 'Dad', trade_occupation_id: smith });
        const kid = (name: string, gender: string, weeks: number) => anthro({
            owner: alice, name, gender, young: 1,
            sire_id: dad.id, dam_id: mom.id, birthdate: gmdate('Y-m-d', strtotimeOrThrow(`-${weeks} weeks`)),
            fertile_on: gmdate('Y-m-d', strtotimeOrThrow('+5 weeks')),
        });

        // Under 5 weeks: rest, and it can't be planned otherwise.
        const baby = kid('Baby', 'Female', 2);
        expect(Object.values(Schedules.weekly(baby.id)).map((d) => d.activity)).toEqual(Array(7).fill('rest'));
        expect(Schedules.planDay(alice, baby, gmdate('Y-m-d'), 'work', 'f')).toBe('Baby is too young: under 5 weeks old, it only rests.');
        expect(Schedules.setWeekly(alice, baby, everyDay('rest'))).toBe('Baby is too young: under 5 weeks old, it only rests.');

        // Then learning a parent's trade: a girl her mother's, a boy his father's.
        const girl = kid('Girl', 'Female', 6);
        const boy = kid('Boy', 'Male', 6);
        const day = Schedules.weekly(girl.id)[1];
        expect([day.activity, day.skill_name, day.mentor_name]).toEqual(['train', 'Cooking', 'Mom']);
        expect([Schedules.weekly(boy.id)[1].activity, Schedules.weekly(boy.id)[1].skill_name, Schedules.weekly(boy.id)[1].mentor_name])
            .toEqual(['train', 'Metalworking', 'Dad']);
        Schedules.runDefaults();
        expect(Schedules.log(girl.id)[0].outcome).toBe('Learned Cooking from Mom (Novice).');
        expect(Schedules.log(baby.id), 'Resting days aren\'t logged.').toEqual([]);

        // A Journeyman at it (28 days), it works it.
        db().run('UPDATE game_anthro_skills SET practice = 28 WHERE anthro_id = ?', [girl.id]);
        expect([Schedules.weekly(girl.id)[1].activity, Schedules.weekly(girl.id)[1].occupation_id]).toEqual(['work', baker]);

        // No father to learn from: his mother; no one: a trade of his own.
        const orphan = anthro({ owner: alice, name: 'Orphan', young: 1, dam_id: mom.id, birthdate: gmdate('Y-m-d', strtotimeOrThrow('-6 weeks')) });
        expect(Schedules.weekly(orphan.id)[1].skill_name).toBe('Cooking');
        const foundling = anthro({ owner: alice, name: 'Foundling', young: 1, birthdate: gmdate('Y-m-d', strtotimeOrThrow('-6 weeks')) });
        expect([Schedules.weekly(foundling.id)[1].activity, Schedules.weekly(foundling.id)[1].mentor_name]).toEqual(['train', null]);
    });

    test('with nothing to eat or spend it forages', () => {
        db().exec("DELETE FROM game_daily WHERE task = 'defaults'");
        const poor = anthro({ name: 'Poor' });
        setCoins(poor.id, 0);
        db().run("UPDATE game_goods SET quantity = 0 WHERE anthro_id = ? AND good = 'food'", [poor.id]);
        Schedules.runDefaults();
        expect(Schedules.log(poor.id)[0].outcome).toMatch(/^Foraged [1-3] food\.$/);
    });

    test('plans made after the day\'s work wait for tomorrow', () => {
        expect(Schedules.runToday(), 'Nothing planned yet, but the day\'s work is done.').toBe(0);
        const alice = player('alice');
        const me = playerAnthro(alice);
        const food = Goods.amount(me.id);
        expect(Schedules.setWeekly(alice, me, everyDay('work', 'f'))).toBeNull();
        expect(Schedules.runToday()).toBe(0);
        expect([Goods.amount(me.id), Schedules.log(me.id)], 'No foraging until tomorrow.').toEqual([food, []]);
    });

    test('skills and levels', () => {
        const skills = [...Schedules.skills().values()];
        expect(skills).toContain('Witchcraft');
        expect(skills).toContain('Prostitution');
        expect(skills).toContain('Administration');
        expect(skills, 'Occupations are titles now...').not.toContain('Blacksmith');
        const titles = new Map([...Schedules.occupations().values()].map((o) => [o.id, o.skill]));
        expect(titles.get(occupationId('Blacksmith')), '...each with a skill.').toBe('Metalworking');
        expect([...Schedules.occupations().values()].filter((o) => o.skill === 'Cooking').map((o) => o.title)).toEqual(['Baker', 'Chef']);
        expect([...Schedules.occupations().values()].filter((o) => o.title === 'Hunter').map((o) => o.skill), 'A Hunter uses a longbow, or falcons.')
            .toEqual(['Archery', 'Falconry']);
        expect([0, 1, 6, 7, 28, 84].map(Schedules.level)).toEqual(['Untrained', 'Novice', 'Novice', 'Apprentice', 'Journeyman', 'Master']);
    });

    test('who plans', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const slave = playerAnthro(bob, { owner: alice });
        expect(Schedules.canPlan(bob, slave), 'The anthro itself.').toBe(true);
        expect(Schedules.canPlan(alice, slave), 'Its owner.').toBe(true);
        expect(Schedules.canPlan(player('carol'), slave)).toBe(false);
        expect(Schedules.canPlan(admin(), slave)).toBe(true);
        expect(Schedules.canPlan(alice, anthro({ died_at: gmdate('Y-m-d H:i:s') }))).toBe(false);
    });

    test('the weekly routine', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        const mate = anthro({ owner: alice, gender: 'Female', name: 'Mate' });
        const stranger = anthro();
        expect(Schedules.weekly(me.id)[3].activity, 'Left out: rest.').toBe('rest');

        const week = everyDay('work', 'o:' + occupationId('Farmer'));
        week[6] = week[7] = { activity: 'rest' };
        week[3] = { activity: 'breed', detail: 'p:' + stranger.id };
        expect(Schedules.setWeekly(alice, me, week)).toBe('Wednesday: Choose who to breed with, or which breeding group.');
        week[3] = { activity: 'breed', detail: 'p:' + mate.id };
        week[1] = { activity: 'train', detail: '' };
        expect(Schedules.setWeekly(alice, me, week)).toBe('Monday: Choose a skill to train.');
        week[1] = { activity: 'train', detail: 's:' + skillId('Witchcraft') };
        expect(Schedules.setWeekly(alice, me, week)).toBeNull();

        const routine = Schedules.weekly(me.id);
        expect(Object.values(routine).map((d) => d.activity)).toEqual(['train', 'work', 'breed', 'work', 'work', 'rest', 'rest']);
        expect(routine[3].partner_name).toBe('Mate');
        expect(routine[1].skill_name).toBe('Witchcraft');
        expect(Schedules.setWeekly(player('bobby'), me, week)).toBe(`You don't plan ${me.name}'s days.`);
    });

    test('standard schedules', () => {
        const alice = player('alice');
        playerAnthro(alice, { name: 'Me' });
        const mate = anthro({ owner: alice, gender: 'Female', name: 'Mate' });
        const serf = anthro({ owner: alice, name: 'Serf' });
        Schedules.setWeekly(alice, serf, everyDay('work', 'f'));

        expect(Schedules.createStandard(alice, ' ')).toEqual([null, 'Name the schedule (up to 40 characters).']);
        const [fieldId] = Schedules.createStandard(alice, 'Field hands') as [number, null];
        expect(Schedules.createStandard(alice, 'Field hands')).toEqual([null, 'You already have a schedule called Field hands.']);
        const [restId] = Schedules.createStandard(alice, 'Rest days') as [number, null];
        expect(Schedules.standards(alice.id).map((s) => s.name)).toEqual(['Field hands', 'Rest days']);

        // Checked against what Alice can plan for any of her anthros: here, breeding with Mate.
        const week = everyDay('work', 'o:' + occupationId('Farmer'));
        week[3] = { activity: 'breed', detail: 'p:' + mate.id };
        week[7] = { activity: 'rest' };
        week[2] = { activity: 'breed', detail: 'p:' + anthro().id };
        expect(Schedules.setStandardWeek(alice, Schedules.standard(fieldId)!, week)).toBe('Tuesday: Choose who to breed with, or which breeding group.');
        week[2] = week[1];
        expect(Schedules.setStandardWeek(alice, Schedules.standard(fieldId)!, week)).toBeNull();
        const bob = player('bobby');
        expect(Schedules.setStandardWeek(bob, Schedules.standard(fieldId)!, week)).toBe("That schedule isn't yours.");

        // Followers take its week; their own routines are kept for when they stop.
        expect(Schedules.follow(alice, serf, fieldId)).toBeNull();
        expect(Schedules.follow(alice, mate, fieldId)).toBeNull();
        const carol = player('carol');
        expect(Schedules.follow(carol, playerAnthro(carol), fieldId)).toBe('Choose one of your standard schedules.');
        expect(Schedules.weekly(serf.id)[1].activity).toBe('work');
        expect(Schedules.weekly(serf.id, true)[1].activity, 'Its own routine is kept.').toBe('forage');
        expect(Schedules.standard(fieldId)!.followers.map((a: Row) => a.name)).toEqual(['Mate', 'Serf']);

        // One change reaches them all.
        week[1] = { activity: 'train', detail: 's:' + skillId('Letters') };
        Schedules.setStandardWeek(alice, Schedules.standard(fieldId)!, week);
        expect([Schedules.weekly(serf.id)[1].activity, Schedules.weekly(mate.id)[1].activity]).toEqual(['train', 'train']);

        // Carried out like any routine; a follower that's the partner can't breed with itself.
        const wednesday = nextWednesday();
        expect([Schedules.upcoming(serf, 7)[wednesday].activity, Schedules.upcoming(serf, 7)[wednesday].source]).toEqual(['breed', 'routine']);
        Schedules.setStandardWeek(alice, Schedules.standard(fieldId)!, everyDay('breed', 'p:' + mate.id));
        expect(Schedules.runToday()).toBe(2);
        expect(Schedules.log(mate.id)[0].outcome).toBe('Meant to breed with Mate: itself.');
        expect(Schedules.log(serf.id)[0].outcome.startsWith('Bred with Mate')).toBe(true);

        // Sold on, it's back on its own routine; removing a schedule sends its followers back too.
        db().run('UPDATE game_anthros SET owner_id = ? WHERE id = ?', [anthroOf(bob), serf.id]);
        expect(Schedules.standardFor(serf.id)).toBeNull();
        expect(Schedules.weekly(serf.id)[1].activity).toBe('forage');
        expect(Schedules.deleteStandard(alice, Schedules.standard(fieldId)!)).toBeNull();
        expect(Schedules.standardFor(mate.id)).toBeNull();
        expect(Schedules.standards(alice.id).map((s) => s.name)).toEqual(['Rest days']);
        expect(Schedules.renameStandard(alice, Schedules.standard(restId)!, 'Sundays')).toBeNull();
        expect(Schedules.standard(restId)!.name).toBe('Sundays');
    });

    test('planned days break the routine and birthing trumps all', () => {
        const alice = player('alice');
        let me = playerAnthro(alice, { gender: 'Female' });
        Schedules.setWeekly(alice, me, everyDay('work', 'o:' + occupationId('Farmer')));
        const inThree = gmdate('Y-m-d', strtotimeOrThrow('+3 days'));
        expect(Schedules.planDay(alice, me, gmdate('Y-m-d', strtotimeOrThrow('-1 day')), 'rest', ''))
            .toBe('Choose a day from today to ' + gmdate('Y-m-d', strtotimeOrThrow('+70 days')) + '.');
        expect(Schedules.planDay(alice, me, inThree, 'train', 's:' + skillId('Healing'))).toBeNull();
        const upcoming = Schedules.upcoming(me);
        expect([upcoming[gmdate('Y-m-d')].activity, upcoming[gmdate('Y-m-d')].source]).toEqual(['work', 'routine']);
        expect([upcoming[inThree].activity, upcoming[inThree].source, upcoming[inThree].skill_name]).toEqual(['train', 'planned', 'Healing']);

        // Pregnant: her due date is birthing, and can't be planned.
        Litters.attempt(anthro(), me, null, false);
        me = refresh(me);
        expect([Schedules.planFor(me, me.pregnant_due_on).activity, Schedules.upcoming(me, 70)[me.pregnant_due_on].source]).toEqual(['birthing', 'birthing']);
        expect(Schedules.planDay(alice, me, me.pregnant_due_on, 'rest', '')).toBe(`${me.name} is due to give birth that day, and can do nothing else.`);

        expect(Schedules.unplanDay(alice, me, inThree)).toBeNull();
        expect(Schedules.upcoming(me)[inThree].source).toBe('routine');
    });

    test('today\'s plans are carried out once', () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { name: 'Me' });
        const mate = anthro({ owner: alice, gender: 'Female', name: 'Mate' });
        const scholar = anthro({ owner: alice, name: 'Scholar' });
        const today = gmdate('Y-m-d');
        Schedules.planDay(alice, me, today, 'breed', 'p:' + mate.id);
        Schedules.planDay(alice, scholar, today, 'train', 's:' + skillId('Letters'));
        expect(Schedules.planDay(alice, mate, today, 'work', '')).toBe('Choose what to work at: an occupation, clearing land, building or foraging.');
        Schedules.planDay(alice, mate, today, 'work', 'o:' + occupationId('Weaver'));
        learn(mate, 'Weaving');

        expect(Schedules.runToday()).toBe(3);
        expect(Schedules.runToday(), 'Once a day.').toBe(0);
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings WHERE sire_id = ? AND dam_id = ?', [me.id, mate.id])), 'They take the roles they can.')
            .toBe(1);
        expect(Schedules.log(me.id)[0].outcome).toBe('Bred with Mate: Mate is expecting a litter of 1.');
        expect(Schedules.skillsOf(scholar.id)).toEqual([{ name: 'Letters', practice: 1, level: 'Novice', titles: 'Scribe, Clerk' }]);
        expect(Schedules.log(scholar.id)[0].outcome).toBe('Trained: Letters (Novice).');
        expect(Schedules.log(mate.id)[0].outcome).toBe('Worked as Weaver (Weaving: Novice), earning 2 coins for Me.');
        expect(coins(me.id), 'A slave\'s pay goes to its owner.').toBe(2);
        expect(Schedules.skillsOf(mate.id).map((s) => s.name), 'Work is practice too.').toEqual(['Weaving']);
    });

    test('breeding in a group and losing a partner', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        const mate = anthro({ owner: alice, gender: 'Female', name: 'Wife' });
        const [groupId] = Groups.create(alice, 'Nest', [me.id, mate.id]);
        const bob = player('bobby');
        const today = gmdate('Y-m-d');
        expect(Schedules.planDay(alice, mate, today, 'breed', 'g:' + groupId)).toBeNull();
        const loner = anthro({ owner: alice });
        const other = anthro({ owner: alice, gender: 'Female' });
        expect(Schedules.planDay(alice, loner, today, 'breed', 'p:' + other.id)).toBeNull();
        // The partner changes hands before the day comes.
        db().run('UPDATE game_anthros SET owner_id = ? WHERE id = ?', [anthroOf(bob), other.id]);

        Schedules.runToday();
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings WHERE group_id = ?', [groupId]))).toBe(1);
        expect(Schedules.log(mate.id)[0].outcome.startsWith('Bred with ' + me.name)).toBe(true);
        expect(Schedules.log(loner.id)[0].outcome).toBe('Meant to breed, but the partner is no longer there to breed with.');
    });

    test('birthing days are logged', () => {
        const alice = player('alice');
        const dam = playerAnthro(alice, { gender: 'Female' });
        Schedules.setWeekly(alice, dam, everyDay('work', 'o:' + occupationId('Farmer')));
        Litters.attempt(anthro(), dam, null, false);
        db().exec('UPDATE game_litters SET due_on = UTC_DATE()');
        Litters.deliverDue();
        Schedules.runToday();
        const log = Schedules.log(dam.id)[0];
        expect([log.activity, log.outcome]).toEqual(['birthing', 'Gave birth.']);
    });

    test('clearing, building and foraging', () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { name: 'Lord' });
        const serf = anthro({ owner: alice, name: 'Serf' });
        const gatherer = anthro({ owner: alice, name: 'Gatherer' });
        const today = gmdate('Y-m-d');
        expect(Schedules.planDay(alice, serf, today, 'work', 'c:wilds')).toBeNull();
        expect(Schedules.planDay(alice, gatherer, today, 'work', 'f')).toBeNull();
        Schedules.runToday();
        const lot = db().row(`SELECT * FROM game_parcels WHERE anthro_id = ${me.id}`)!;
        expect([lot.acres, lot.barony_id, lot.part_id], 'A quarter acre of the wilds, for its owner.').toEqual([0.25, null, null]);
        expect(Schedules.log(serf.id)[0].outcome).toBe(`Cleared 0.25 acres in the wilds for Lord (lot #${lot.id} is 0.25 acres now), and 2 lumber.`);
        expect(Goods.amount(me.id, 'lumber'), 'Lumber for its owner.').toBe(2);
        const foraged = int(Schedules.log(gatherer.id)[0].outcome.replace(/\D/g, ''));
        expect(foraged >= 1 && foraged <= 3, `Foraged ${foraged} food.`).toBe(true);
        expect(Goods.amount(me.id), 'For its owner.').toBe(Goods.STARTING_FOOD + foraged);
        expect(Schedules.skillsOf(serf.id), 'No skill in clearing.').toEqual([]);

        // Build on the lot, once it's big enough.
        db().run('UPDATE game_parcels SET acres = 2 WHERE id = ?', [lot.id]);
        const house = Number(scalar("SELECT id FROM game_building_types WHERE name = 'House'"));
        const [buildingId, error] = Buildings.start(alice, house, int(lot.id));
        expect(error).toBeNull();
        expect(Buildings.start(player('bobby'), house, int(lot.id))).toEqual([null, 'Choose a lot of yours to build on.']);
        const tomorrow = gmdate('Y-m-d', strtotimeOrThrow('+1 day'));
        expect(Schedules.planDay(alice, serf, tomorrow, 'work', 'b:' + buildingId)).toBeNull();
        const plan = Schedules.planFor(refresh(serf), tomorrow);
        expect([plan.activity, plan.building_name, plan.building_lot]).toEqual(['build', 'House', lot.id]);
        db().run('UPDATE game_buildings SET progress = 9 WHERE id = ?', [buildingId]);
        db().run('DELETE FROM game_schedule_days WHERE anthro_id = ? AND day = UTC_DATE()', [serf.id]);
        db().run('UPDATE game_schedule_days SET day = UTC_DATE() WHERE anthro_id = ?', [serf.id]);
        db().run('DELETE FROM game_schedule_log WHERE anthro_id = ?', [serf.id]);
        db().exec("DELETE FROM game_daily WHERE task = 'schedules'");
        Schedules.runToday();
        expect(Schedules.log(serf.id)[0].outcome).toBe("Built the House: it's finished.");
        expect(Goods.amount(me.id, 'lumber'), 'Building used a lumber.').toBe(1);
        expect(Buildings.find(buildingId!)!.finished_at).not.toBeNull();
        expect(notificationsFor(me.id)).toContain(`The House on lot #${lot.id} is finished.`);
    });

    test('buildings need free land', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, 0.6)', [me.id]);
        const lot = db().lastInsertId();
        const barn = Number(scalar("SELECT id FROM game_building_types WHERE name = 'Barn'"));
        expect(Buildings.start(alice, barn, lot)[1]).toBeNull();
        expect(Buildings.start(alice, barn, lot)).toEqual([null, 'A Barn needs 0.5 acres, and lot #' + lot + ' has 0.1 acres free.']);
        expect(Land.split(alice, lot, '0.2')).toEqual([null, 'Only 0.1 acres of it is free: buildings stand on the rest.']);
        expect(Land.split(alice, lot, '0.1')[1]).toBeNull();
    });

    test('clearing an expanse', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        const barony = baronyId();
        db().run("INSERT INTO game_barony_parts (barony_id, name, kind) VALUES (?, 'Wildwood', 'expanse')", [barony]);
        const expanse = db().lastInsertId();
        expect(Schedules.planDay(alice, me, gmdate('Y-m-d'), 'work', 'c:' + expanse)).toBeNull();
        Schedules.runToday();
        Schedules.runToday();
        const lot = db().row(`SELECT * FROM game_parcels WHERE anthro_id = ${me.id}`)!;
        expect([lot.barony_id, lot.part_id, lot.acres], 'Its own land, in that expanse.').toEqual([barony, expanse, 0.25]);
    });

    test('everyone eats from their keeper', () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { name: 'Keeper' });
        const slaves = range(1, 3).map((i) => anthro({ owner: alice, name: `Slave${i}` }));
        const loner = anthro({ name: 'Loner' });
        db().run("UPDATE game_goods SET quantity = 0 WHERE anthro_id = ? AND good = 'food'", [loner.id]);
        db().run("UPDATE game_goods SET quantity = 3 WHERE anthro_id = ? AND good = 'food'", [me.id]);
        expect(Goods.amount(slaves[0].id), 'New anthros start with a week\'s food...').toBe(Goods.STARTING_FOOD);

        expect(Goods.feedToday(), 'Keeper and two slaves eat; the third slave and the loner go hungry.').toBe(2);
        expect(Goods.feedToday(), 'Once a day.').toBe(0);
        expect(Goods.amount(me.id)).toBe(0);
        expect(Goods.amount(slaves[0].id), '...but owned ones eat their owner\'s.').toBe(Goods.STARTING_FOOD);
        expect(Goods.isHungry(refresh(me)), 'The keeper eats first.').toBe(false);
        expect(Goods.isHungry(refresh(slaves[2]))).toBe(true);
        expect(Goods.isHungry(refresh(loner))).toBe(true);
        expect(Anthros.breedingBlocker(refresh(loner), 'sire')).toBe('too hungry');
    });

    test('employees feed themselves but their work goes to their employer', () => {
        const alice = player('alice');
        const boss = playerAnthro(alice, { name: 'Boss' });
        const hand = anthro({ name: 'Hand', employer: alice, employed_wage: 1, employed_since: gmdate('Y-m-d H:i:s'), paid_until: gmdate('Y-m-d') });
        const bob = player('bobby');
        const lent = anthro({ name: 'Lent', owner: bob, employer: alice, employed_wage: 1, employed_since: gmdate('Y-m-d H:i:s'), paid_until: gmdate('Y-m-d') });
        expect(Goods.household(boss.id), 'An employer doesn\'t feed its employees...').toEqual([boss.id]);
        expect(Goods.household(anthroOf(bob)), '...an owner feeds its own, even hired out.').toContain(lent.id);
        Goods.feedToday();
        expect(Goods.amount(boss.id)).toBe(Goods.STARTING_FOOD - 1);
        expect(Goods.amount(hand.id), 'A free employee feeds itself.').toBe(Goods.STARTING_FOOD - 1);

        Schedules.planDay(alice, hand, gmdate('Y-m-d'), 'work', 'f');
        Schedules.runToday();
        expect(Schedules.log(hand.id)[0].outcome.endsWith('for Boss.'), 'What it forages goes to its employer.').toBe(true);
        expect(Goods.amount(boss.id)).toBeGreaterThan(Goods.STARTING_FOOD - 1);
    });

    test('anthros on the market are fed', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        const listed = anthro({ owner: alice, name: 'Listed' });
        Auctions.create(listed, alice.id, 10, null, 1);
        Auctions.supply(1, 10, null, 1);
        db().run("UPDATE game_goods SET quantity = 0 WHERE anthro_id = ? AND good = 'food'", [me.id]);
        db().exec('UPDATE game_anthros SET hungry_on = UTC_DATE()');

        expect(Goods.household(me.id), 'Its listed anthro isn\'t a mouth to feed...').toEqual([me.id]);
        expect(Goods.isHungry(refresh(listed)), '...it\'s fed on the market,').toBe(false);
        const game = Anthros.findAny(Number(scalar('SELECT id FROM game_anthros WHERE owner_id IS NULL')))!;
        expect(Goods.isHungry(game), 'as are the game\'s own.').toBe(false);
        expect(Goods.isHungry(refresh(me))).toBe(true);
    });

    test('meals are bought when the food runs out', () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { name: 'Keeper' });
        const slaves = range(1, 3).map((i) => anthro({ owner: alice, name: `Slave${i}` }));
        db().run("UPDATE game_goods SET quantity = 1 WHERE anthro_id = ? AND good = 'food'", [me.id]);
        setCoins(me.id, 12);

        expect(Goods.feedToday(), 'One meal from the store, two bought for 10 coins, and one slave goes hungry.').toBe(1);
        expect(coins(me.id)).toBe(2);
        expect(Goods.meals()!.bought).toEqual(new Map([[me.id, 2]]));
        expect(Goods.isHungry(refresh(slaves[2]))).toBe(true);
        expect(Goods.isHungry(refresh(slaves[1]))).toBe(false);
        expect(scalar('SELECT reason FROM game_ledger WHERE anthro_id = ? ORDER BY id DESC LIMIT 1', [me.id])).toBe('Bought 2 meals at the market');
    });

    test('the hungry can only rest or forage', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        const today = gmdate('Y-m-d');
        Schedules.planDay(alice, me, today, 'train', 's:' + skillId('Letters'));
        db().run('UPDATE game_anthros SET hungry_on = UTC_DATE() WHERE id = ?', [me.id]);
        Schedules.runToday();
        const log = Schedules.log(me.id)[0];
        expect([log.activity, log.outcome]).toEqual(['rest', 'Too hungry to train: rested.']);
        expect(Schedules.skillsOf(me.id)).toEqual([]);

        db().exec('DELETE FROM game_schedule_log');
        db().exec("DELETE FROM game_daily WHERE task = 'schedules'");
        Schedules.planDay(alice, me, today, 'work', 'f');
        Schedules.runToday();
        expect(Schedules.log(me.id)[0].outcome.startsWith('Foraged'), 'Foraging is how the hungry get food.').toBe(true);
    });

    test('building needs lumber', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, 1)', [me.id]);
        const lot = db().lastInsertId();
        const [buildingId, error] = Buildings.start(alice, Number(scalar("SELECT id FROM game_building_types WHERE name = 'House'")), lot);
        expect(error).toBeNull();
        expect(Schedules.planDay(alice, me, gmdate('Y-m-d'), 'work', 'b:' + buildingId)).toBeNull();
        Schedules.runToday();
        expect(Schedules.log(me.id)[0].outcome).toBe('Went to build the House, but there was no lumber.');
        expect(Buildings.find(buildingId!)!.progress).toBe(0);
    });
});
