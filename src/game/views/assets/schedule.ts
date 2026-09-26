// Upstream: game/views/assets/schedule.blade.php
import { cls, html, selected, type Html } from '../../../core/html';
import { field, type InputArray } from '../../../core/http';
import { gmdate, int, strtotimeOrThrow, ucfirst } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Anthros } from '../../Anthros';
import { Clock } from '../../Clock';
import { Land } from '../../Land';
import { Schedules, type PlanOptions } from '../../Schedules';
import gameLayout from '../layouts/game';
import planFields from './plan-fields';
import planScript from './plan-script';
import planText from './plan-text';

export default function schedule(v: ViewContext, {
    anthro, week, errorDay, planned, standard, standards, upcoming, log, anthroSkills, options, master, buildingTypes, lots, error, post,
}: {
    anthro: Row; week: Record<number, Row>; errorDay: number | null; planned: Record<string, Row>; standard: Row | null;
    standards: Row[]; upcoming: Record<string, Row>; log: Row[]; anthroSkills: { name: string; practice: number; level: string; titles: string }[];
    options: PlanOptions; master: Row | null; buildingTypes: Map<number, Row>; lots: Row[]; error: string | null;
    /** $_POST: what was just sent. */
    post: InputArray;
}): Html {
    const user = v.user!;
    const postAction = field(post, 'action');
    const upcomingDates = Object.keys(upcoming);
    // The same days as a calendar: Monday to Sunday, from the week today is in.
    const first = upcomingDates[0];
    const gridStart = strtotimeOrThrow(first + ' UTC') - (Clock.weekday(first) - 1) * 86400;
    const gridDays = int(Math.ceil(((strtotimeOrThrow(upcomingDates[upcomingDates.length - 1] + ' UTC') - gridStart) / 86400 + 1) / 7)) * 7;
    const calendar: Html[] = [];
    for (let i = 0; i < gridDays; i++) {
        const date = gmdate('Y-m-d', gridStart + i * 86400);
        const plan = upcoming[date] ?? null;
        calendar.push(html`
                        ${i % 7 === 0 ? html`
                            <tr>` : ''}
                        <td class="align-top ${!plan ? 'text-body-tertiary' : plan.source === 'birthing' ? 'table-info' : plan.source === 'planned' ? 'table-secondary' : ''}"
                            style="height: 5rem">
                            <div class="${date === first ? 'fw-bold' : ''}">${date === first ? 'Today' : int(gmdate('j', strtotimeOrThrow(date + ' UTC')))}</div>
                            ${plan && plan.source === 'planned' ? html`
                                <span class="badge text-bg-secondary">planned</span>` : ''}
                            ${plan ? html`
                                <div>${planText(v, { plan })}</div>` : ''}
                        </td>
                        ${i % 7 === 6 ? html`
                            </tr>` : ''}`);
    }
    const weekdays: Html[] = [];
    for (let day = 1; day <= 7; day++) {
        weekdays.push(html`
                            <th class="text-center">${Anthros.weekday(day).substring(0, 3)}</th>`);
    }
    const sites = options.sites;
    return gameLayout(v, {
        title: anthro.name + "'s schedule - Game",
        content: html`
    <p><a href="/game/assets/${anthro.id}">&larr; ${anthro.name}</a></p>
    <h1 class="h3 mb-1">${anthro.name}'s schedule</h1>
    <p class="text-body-secondary">
        What ${anthro.name} does each day: a weekly routine (its own, or a standard schedule it follows), and days
        planned ahead that break it. Each day the
        plan is carried out. Breeding is with the partner or breeding group chosen (a group's member is picked at random).
        Training at a skill, or working at an occupation, is a day's practice at the skill (Novice, then Apprentice after
        7 days, Journeyman after 28 and Master after 84). An occupation takes training first: until
        ${anthro.name} has trained at its skill, a day planned working at it is spent resting. Work can also be clearing land (${Land.acres(Schedules.CLEAR_ACRES)}
        a day), building, or foraging for food${master && master.id !== anthro.id ? ', all for ' + master.name : ''}.
        The day a litter is due, a dam is birthing and does nothing else.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}

    <div class="row g-4">
        <div class="col-lg-6">
            ${Schedules.isResting(anthro) ? html`
                <div class="alert alert-info">
                    ${anthro.name} is under ${Schedules.REST_WEEKS} weeks old, and only rests until
                    ${gmdate('Y-m-d', strtotimeOrThrow(anthro.birthdate + ' UTC +' + Schedules.REST_WEEKS + ' weeks'))}. Then it
                    learns a trade from its ${(anthro.presents_as ?? '') === 'male' ? 'father' : 'mother'}, until it can work at it.
                </div>` : html`
            <h2 class="h5">Weekly routine</h2>
            ${standards.length || standard ? html`
                <form method="post" action="/game/assets/${anthro.id}/schedule" class="d-flex flex-wrap align-items-center gap-2 mb-2">
                    <input type="hidden" name="csrf" value="${v.csrf}">
                    <input type="hidden" name="action" value="follow">
                    <label class="small" for="standard_id">Follows</label>
                    <select class="form-select form-select-sm w-auto" id="standard_id" name="standard_id">
                        <option value="">its own routine</option>
                        ${standard && !standards.some((option) => option.id == standard.id) ? html`
                            <option value="${standard.id}" selected>${standard.name}</option>` : ''}
                        ${standards.map((option) => html`
                            <option value="${option.id}" ${selected(standard && standard.id == option.id)}>${option.name}</option>`)}
                    </select>
                    <button class="btn btn-sm btn-outline-primary">Follow</button>
                    <a class="small" href="/game/assets/schedules">Standard schedules</a>
                </form>` : ''}
            ${standard ? html`
                <div class="card card-body mb-3">
                    <p class="small mb-2">
                        Following the standard schedule <strong>${standard.name}</strong>${Schedules.ownsStandard(user, standard) ? html` (<a href="/game/assets/schedules/${standard.id}">change it</a> for all who follow it)` : ''}:
                    </p>
                    <ul class="list-unstyled small mb-0">
                        ${Object.entries(standard.week as Record<number, Row>).map(([weekday, plan]) => html`
                            <li><span class="text-body-secondary">${Anthros.weekday(int(weekday))}:</span> ${planText(v, { plan })}</li>`)}
                    </ul>
                </div>` : ''}
            <details class="mb-4" ${!standard ? 'open' : ''}>
            <summary class="small mb-2" ${!standard ? 'hidden' : ''}>${anthro.name}'s own routine, for when it stops following</summary>
            <form method="post" action="/game/assets/${anthro.id}/schedule" class="card card-body">
                <input type="hidden" name="csrf" value="${v.csrf}">
                <input type="hidden" name="action" value="weekly">
                ${Object.entries(week).map(([weekday, plan]) => html`
                    <div class="row g-2 align-items-center mb-2">
                        <div class="col-3 small">${Anthros.weekday(int(weekday))}</div>
                        <div class="col-9">
                            ${planFields(v, { plan, options, names: [`days[${weekday}][activity]`, `days[${weekday}][detail]`],
                                invalid: errorDay === int(weekday) })}
                        </div>
                    </div>`)}
                <div><button class="btn btn-primary btn-sm">Save routine</button></div>
            </form>
            </details>

            <h2 class="h5">Plan a day</h2>
            <form method="post" action="/game/assets/${anthro.id}/schedule" class="card card-body mb-3">
                <input type="hidden" name="csrf" value="${v.csrf}">
                <input type="hidden" name="action" value="plan">
                <div class="d-flex flex-wrap align-items-center gap-2">
                    <input class="form-control form-control-sm w-auto" type="date" name="date" required aria-label="Day"
                           min="${gmdate('Y-m-d')}" max="${gmdate('Y-m-d', strtotimeOrThrow('+' + Schedules.PLAN_AHEAD_DAYS + ' days'))}"
                           value="${field(post, 'date')}">
                    ${planFields(v, { plan: postAction === 'plan'
                        ? { activity: field(post, 'activity', 'work'), detail: field(post, 'detail') } : { activity: 'work' },
                        options, names: ['activity', 'detail'], invalid: error !== null && postAction === 'plan' })}
                    <button class="btn btn-outline-primary btn-sm">Plan</button>
                </div>
                <div class="form-text">That day, this replaces the routine.</div>
            </form>`}
            ${Object.keys(planned).length ? html`
                <ul class="list-group mb-4">
                    ${Object.entries(planned).map(([date, plan]) => html`
                        <li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2">
                            <span>
                                <span class="text-body-secondary">${Anthros.weekday(Clock.weekday(date))} ${date}:</span>
                                ${planText(v, { plan })}
                            </span>
                            <form method="post" action="/game/assets/${anthro.id}/schedule" class="m-0">
                                <input type="hidden" name="csrf" value="${v.csrf}">
                                <input type="hidden" name="action" value="unplan">
                                <input type="hidden" name="date" value="${date}">
                                <button class="btn btn-sm btn-outline-secondary">Back to the routine</button>
                            </form>
                        </li>`)}
                </ul>` : ''}
        </div>

        <div class="col-lg-6">
            <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                <h2 class="h5 mb-0">The next two weeks</h2>
                <div class="btn-group btn-group-sm" role="group" aria-label="Show as" data-upcoming-views>
                    <button type="button" class="btn btn-outline-secondary active" data-show="list" aria-pressed="true">List</button>
                    <button type="button" class="btn btn-outline-secondary" data-show="calendar" aria-pressed="false">Calendar</button>
                </div>
            </div>
            <div data-upcoming="list">
            <ul class="list-group mb-4">
                ${Object.entries(upcoming).map(([date, plan], i) => html`
                    <li class="${cls('list-group-item py-1 d-flex justify-content-between gap-2', { 'list-group-item-light': plan.source !== 'routine' })}">
                        <span>
                            <span class="text-body-secondary small">${i === 0 ? 'Today' : Anthros.weekday(Clock.weekday(date))} ${date}</span>
                            &middot; ${planText(v, { plan })}
                        </span>
                        ${plan.source !== 'routine' ? html`
                            <span class="badge ${plan.source === 'birthing' ? 'text-bg-info' : 'text-bg-secondary'} align-self-center">${plan.source}</span>` : ''}
                    </li>`)}
            </ul>
            </div>
            <div class="mb-4" data-upcoming="calendar" hidden>
                <table class="table table-bordered table-sm small mb-0" style="table-layout: fixed; overflow-wrap: break-word; hyphens: auto">
                    <thead>
                    <tr>
                        ${weekdays}
                    </tr>
                    </thead>
                    <tbody>
                    ${calendar}
                    </tbody>
                </table>
            </div>

            ${master ? html`
                <h2 class="h5">Buildings</h2>
                ${sites.length ? html`
                    <ul class="list-unstyled mb-2">
                        ${sites.map((site) => html`
                            <li>The ${site.name} on lot #${site.parcel_id}: ${site.progress} of ${site.days} days built</li>`)}
                    </ul>` : html`
                    <p class="text-body-secondary small mb-2">No buildings are going up on ${master.id === anthro.id ? anthro.name + "'s" : master.name + "'s"} land.</p>`}
                ${lots.length && buildingTypes.size ? html`
                    <form method="post" action="/game/assets/${anthro.id}/schedule" class="d-flex flex-wrap align-items-center gap-2 mb-4">
                        <input type="hidden" name="csrf" value="${v.csrf}">
                        <input type="hidden" name="action" value="build">
                        <select class="form-select form-select-sm w-auto" name="type_id" aria-label="What to build">
                            ${[...buildingTypes.values()].map((type) => html`
                                <option value="${type.id}">${type.name} (${type.days} days, ${Land.acres(type.acres)})</option>`)}
                        </select>
                        <select class="form-select form-select-sm w-auto" name="parcel_id" aria-label="Where">
                            ${lots.map((lot) => html`
                                <option value="${lot.id}">on lot #${lot.id} (${Land.acres(lot.acres)}, ${lot.barony_name ?? 'the wilds'})</option>`)}
                        </select>
                        <button class="btn btn-sm btn-outline-primary">Start building</button>
                    </form>` : !lots.length ? html`
                    <p class="text-body-secondary small mb-4">Buildings go up on your land: clear some, or buy a lot, to build on.</p>` : ''}` : ''}

            <h2 class="h5">Skills</h2>
            ${!anthroSkills.length ? html`
                <p class="text-body-secondary">${anthro.name} hasn't trained at anything yet.</p>` : html`
                <ul class="list-unstyled mb-4">
                    ${anthroSkills.map((skill) => html`
                        <li>${skill.name}: <strong>${skill.level}</strong>
                            ${skill.titles ? html`
                                &middot; ${skill.titles.replace(/, ([^,]+)$/, ' or $1')}` : ''}
                            <span class="text-body-secondary small">(${skill.practice} ${skill.practice == 1 ? 'day' : 'days'} of practice)</span></li>`)}
                </ul>`}

            <h2 class="h5">Lately</h2>
            ${!log.length ? html`
                <p class="text-body-secondary">Nothing yet.</p>` : html`
                <ul class="list-unstyled small">
                    ${log.map((entry) => html`
                        <li><span class="text-body-secondary">${entry.day}</span> ${entry.outcome ?? Schedules.LABELS[entry.activity] ?? ucfirst(entry.activity)}</li>`)}
                </ul>`}
        </div>
    </div>

    ${/* The next two weeks as a list or a calendar (the choice is remembered in this browser). */ ''}
    <script>
        (() => {
            const buttons = document.querySelectorAll('[data-upcoming-views] [data-show]');
            const show = (view) => {
                document.querySelectorAll('[data-upcoming]').forEach((el) => { el.hidden = el.dataset.upcoming !== view; });
                buttons.forEach((button) => {
                    button.classList.toggle('active', button.dataset.show === view);
                    button.setAttribute('aria-pressed', String(button.dataset.show === view));
                });
                try { localStorage.setItem('schedule.view', view); } catch {}
            };
            buttons.forEach((button) => button.addEventListener('click', () => show(button.dataset.show)));
            let saved = null;
            try { saved = localStorage.getItem('schedule.view'); } catch {}
            show(saved === 'calendar' ? 'calendar' : 'list');
        })();
    </script>
    ${planScript(v)}`,
    });
}
