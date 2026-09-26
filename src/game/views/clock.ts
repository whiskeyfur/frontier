// Upstream: game/views/clock.blade.php
//
// Not upstream: the pace is the player's own choice, not the slowest anyone asks for (see Clock.wanted).
import { html, type Html } from '../../core/html';
import { gmdate, intdiv, number_format } from '../../core/php';
import type { ViewContext } from '../../core/View';
import { Clock } from '../Clock';

/**
 * The game's calendar (see Game\Clock): its date, the pace its time runs at, and when the next game day comes in
 * real time.
 */
export default function clock(_v: ViewContext): Html {
    const gameTime = Clock.time();
    const untilNext = Math.ceil((86400 - (((gameTime % 86400) + 86400) % 86400)) / Clock.rate());
    return html`
<div class="alert alert-secondary">
    <strong>It's ${gmdate('l, j F Y', gameTime)}</strong> in the game, whose time runs apart from ours:
    ${number_format(Clock.rate(), 2).replace(/0+$/, '').replace(/\.+$/, '')} game ${Clock.rate() == 1 ? 'day' : 'days'} for each real day,
    the pace you choose (under <a href="/game/preferences">Preferences</a>).
    Each game day's business (births and deaths, meals, schedules, taxes, wages and the daily report) is done in turn, for
    everyone at once; plans made during a day take effect the next. The next game day begins in
    ${untilNext >= 86400 ? intdiv(untilNext, 86400) + 'd ' : ''}${intdiv(untilNext % 86400, 3600)}h ${intdiv(untilNext % 3600, 60)}m.
</div>`;
}
