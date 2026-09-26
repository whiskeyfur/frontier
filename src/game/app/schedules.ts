// Upstream: game/src/App.php (schedule, standards, postedWeek, errorDay)
import { Auth, type User } from '../../core/Auth';
import { field, fieldArray } from '../../core/http';
import { Session } from '../../core/Session';
import { int, str } from '../../core/php';
import type { Row } from '../../db/Db';
import type { App } from '../App';
import { Anthros } from '../Anthros';
import { Buildings } from '../Buildings';
import { Land } from '../Land';
import { Schedules } from '../Schedules';
import scheduleView from '../views/assets/schedule';
import standardsView from '../views/assets/standards';
import standardView from '../views/assets/standard';

/**
 * An anthro's schedule: its weekly routine, days planned ahead, what's coming up and what it did lately.
 */
export function schedule(app: App, user: User, anthro: Row, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        const date = field(app.post, 'date');
        switch (action) {
            case 'build': error = Buildings.start(user, int(field(app.post, 'type_id', '0')), int(field(app.post, 'parcel_id', '0')))[1]; break;
            case 'weekly': error = Schedules.setWeekly(user, anthro, fieldArray(app.post, 'days') as Record<number, Row>); break;
            case 'follow': error = Schedules.follow(user, anthro, field(app.post, 'standard_id') === '' ? null : int(field(app.post, 'standard_id'))); break;
            case 'plan': error = Schedules.planDay(user, anthro, date, field(app.post, 'activity'), field(app.post, 'detail')); break;
            case 'unplan': error = Schedules.unplanDay(user, anthro, date); break;
            default: error = 'Unknown action.';
        }
        if (error === null) {
            let standard: Row | null;
            switch (action) {
                case 'build': Session.data.flash = 'The building was started: plan days to build it.'; break;
                case 'weekly': Session.data.flash = `Saved ${anthro.name}'s weekly routine.`; break;
                case 'follow':
                    Session.data.flash = (standard = Schedules.standardFor(anthro.id))
                        ? `${anthro.name} follows ${standard.name} now.` : `${anthro.name} follows its own routine now.`;
                    break;
                case 'plan': Session.data.flash = `Planned ${date}.`; break;
                case 'unplan': Session.data.flash = `${date} follows the routine again.`; break;
            }
            app.redirect('/game/assets/' + anthro.id + '/schedule');
        }
    }
    // A routine that couldn't be saved shows again as it was sent, with the day in error marked.
    const week = error !== null && field(app.post, 'action') === 'weekly' ? postedWeek(app) : Schedules.weekly(anthro.id, true);
    // Buildings go up on the master's land; the user starts them on land their anthro holds.
    const master = Schedules.masterOf(anthro);
    const player = Anthros.player(user.id);
    app.echo(app.render(scheduleView, user, {
        anthro, week, errorDay: errorDay(error), planned: Schedules.planned(anthro.id),
        standard: Schedules.standardFor(anthro.id), standards: Schedules.standards(user.id),
        upcoming: Schedules.upcoming(anthro), log: Schedules.log(anthro.id),
        anthroSkills: Schedules.skillsOf(anthro.id), options: Schedules.options(user, anthro),
        master,
        buildingTypes: Buildings.types(),
        lots: player && master && master.id === player.id ? Land.parcels(player.id) : [],
        error,
        // The view reads $_POST (what was just sent).
        post: app.post,
    }));
}

/**
 * The user's standard schedules (see Schedules.standards): the list, where new ones are started, or (id) one of
 * them, to change its week or name, or remove it.
 */
export function standards(app: App, user: User, id: number | null, post: boolean): void {
    let error: string | null = null;
    if (id === null) {
        if (post) {
            let newId: number | null;
            [newId, error] = Schedules.createStandard(user, field(app.post, 'name'));
            if (error === null) {
                Session.data.flash = 'Started the schedule: plan its week.';
                app.redirect('/game/assets/schedules/' + newId);
            }
        }
        app.echo(app.render(standardsView, user, { standards: Schedules.standards(user.id), error, post: app.post }));
        return;
    }
    const standard = Schedules.standard(id);
    if (!standard || !Schedules.ownsStandard(user, standard)) {
        app.gameNotFound(user);
        return;
    }
    if (post) {
        const action = field(app.post, 'action');
        switch (action) {
            case 'week': error = Schedules.setStandardWeek(user, standard, fieldArray(app.post, 'days') as Record<number, Row>); break;
            case 'rename': error = Schedules.renameStandard(user, standard, field(app.post, 'name')); break;
            case 'delete': error = Schedules.deleteStandard(user, standard); break;
            default: error = 'Unknown action.';
        }
        if (error === null) {
            const followers: Row[] = standard.followers;
            switch (action) {
                case 'week':
                    Session.data.flash = `Saved ${standard.name}` + (followers.length
                        ? ', for ' + followers.length + (followers.length === 1 ? ' anthro' : ' anthros') + ' following it.' : '.');
                    break;
                case 'rename': Session.data.flash = 'Renamed the schedule.'; break;
                case 'delete': Session.data.flash = `Removed ${standard.name}: its followers are back on their own routines.`; break;
            }
            app.redirect(action === 'delete' ? '/game/assets/schedules' : '/game/assets/schedules/' + id);
        }
    }
    const keeper = int(standard.user_id) === user.id ? user : Auth.find(int(standard.user_id))!;
    if (error !== null && field(app.post, 'action') === 'week') {
        standard.week = postedWeek(app);
    }
    app.echo(app.render(standardView, user, {
        standard, options: Schedules.groupOptions(keeper), error, errorDay: errorDay(error),
    }));
}

/**
 * The weekly routine as it was just sent (days[weekday][activity] and [detail]), to show again after an error.
 */
export function postedWeek(app: App): Record<number, Row> {
    const week: Record<number, Row> = {};
    const days = fieldArray(app.post, 'days');
    for (let weekday = 1; weekday <= 7; weekday++) {
        const sent = days[weekday];
        const day = typeof sent === 'object' ? sent : {};
        week[weekday] = { activity: str(day.activity ?? 'rest'), detail: str(day.detail ?? '') };
    }
    return week;
}

/**
 * The weekday a routine's error is about ("Sunday: ..."; see Schedules.setWeekly), or null.
 */
export function errorDay(error: string | null): number | null {
    for (let weekday = 1; error !== null && weekday <= 7; weekday++) {
        if (error.startsWith(Anthros.weekday(weekday) + ':')) {
            return weekday;
        }
    }
    return null;
}
