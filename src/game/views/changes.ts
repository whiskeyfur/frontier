// Upstream: game/views/changes.blade.php
import { html, raw, type Html } from '../../core/html';
import { gmdate, intdiv, strtotimeOrThrow, time } from '../../core/php';
import type { ViewContext } from '../../core/View';
import gameLayout from './layouts/game';

export default function changes(v: ViewContext, { html: body }: { html: string }): Html {
    // The daily tick: the first visit after midnight UTC runs the day's business (see Board.runDaily).
    const next = strtotimeOrThrow('tomorrow 00:00 UTC');
    return gameLayout(v, {
        title: 'Changes - Game',
        content: html`
    <div class="mx-auto" style="max-width: 48rem">
        <h1 class="h3 mb-3">What's changed</h1>
        <div class="alert alert-secondary">
            <strong>The day turns over at 00:00 UTC.</strong> The first visit to the game after that runs the new day's business,
            for everyone at once: births and deaths, meals, schedules and default days, taxes, wages and the daily report.
            Plans made during the day take effect at the next turnover.
            Next: ${gmdate('Y-m-d H:i', next)} UTC, in ${intdiv(next - time(), 3600)}h ${intdiv((next - time()) % 3600, 60)}m.
        </div>
        <div class="changes">${raw(body)}</div>
    </div>`,
    });
}
