// Upstream: game/views/assets/standard.blade.php
import { html, type Html } from '../../../core/html';
import { int, json_encode } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Anthros } from '../../Anthros';
import { Schedules, type PlanOptions } from '../../Schedules';
import gameLayout from '../layouts/game';
import planFields from './plan-fields';
import planScript from './plan-script';

export default function standard(v: ViewContext, { standard, options, error, errorDay }: {
    standard: Row; options: PlanOptions; error: string | null; errorDay: number | null;
}): Html {
    const followers: Row[] = standard.followers;
    return gameLayout(v, {
        title: standard.name + ' - Schedules - Game',
        content: html`
    <p><a href="/game/assets/schedules">&larr; Schedules</a></p>
    <h1 class="h3 mb-1">${standard.name}</h1>
    <p class="text-body-secondary">
        A standard schedule: every anthro following it does this each week (days planned ahead, and birthing, still
        come first). A change here reaches them all.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}

    <div class="row g-4">
        <div class="col-lg-7">
            <h2 class="h5">Weekly routine</h2>
            <form method="post" action="/game/assets/schedules/${standard.id}" class="card card-body mb-4">
                <input type="hidden" name="csrf" value="${v.csrf}">
                <input type="hidden" name="action" value="week">
                ${Object.entries(standard.week as Record<number, Row>).map(([weekday, plan]) => html`
                    <div class="row g-2 align-items-center mb-2">
                        <div class="col-3 small">${Anthros.weekday(int(weekday))}</div>
                        <div class="col-9">
                            ${planFields(v, { plan, options, names: [`days[${weekday}][activity]`, `days[${weekday}][detail]`],
                                invalid: errorDay === int(weekday) })}
                        </div>
                    </div>`)}
                <div><button class="btn btn-primary btn-sm">Save routine</button></div>
                <div class="form-text">
                    Each follower's day is still checked when it comes: one can't breed with itself, or in a group it
                    isn't in, and building is on its master's land.
                </div>
            </form>
        </div>

        <div class="col-lg-5">
            <h2 class="h5">Following it</h2>
            ${followers.length ? html`
                <ul class="list-unstyled mb-4">
                    ${followers.map((follower) => html`
                        <li><a href="/game/assets/${follower.id}/schedule">${follower.name}</a></li>`)}
                </ul>` : html`
                <p class="text-body-secondary mb-4">No one yet. Choose it on an anthro's schedule page, or for several at once from the Overview or Slaves.</p>`}

            <h2 class="h5">Name</h2>
            <form method="post" action="/game/assets/schedules/${standard.id}" class="d-flex flex-wrap gap-2 mb-4">
                <input type="hidden" name="csrf" value="${v.csrf}">
                <input type="hidden" name="action" value="rename">
                <input class="form-control form-control-sm w-auto" name="name" maxlength="${Schedules.MAX_STANDARD_NAME}"
                       value="${standard.name}" aria-label="Name" required>
                <button class="btn btn-sm btn-outline-secondary">Rename</button>
            </form>

            <form method="post" action="/game/assets/schedules/${standard.id}">
                <input type="hidden" name="csrf" value="${v.csrf}">
                <input type="hidden" name="action" value="delete">
                <button class="btn btn-sm btn-outline-danger"
                        onclick="return confirm(${phpJson('Remove ' + standard.name + '? Its followers go back to their own routines.')})">Remove schedule</button>
            </form>
        </div>
    </div>
    ${planScript(v)}`,
    });
}

/** PHP's json_encode of a string: slashes and non-ASCII characters escaped. */
function phpJson(value: string): string {
    return json_encode(value).replace(/\//g, '\\/').replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
