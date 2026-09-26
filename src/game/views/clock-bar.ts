// Upstream: game/views/clock-bar.blade.php
import { cls, html, raw, type Html } from '../../core/html';
import { gmdate, number_format } from '../../core/php';
import type { ViewContext } from '../../core/View';
import { Clock } from '../Clock';
import { Preferences } from '../Preferences';

/**
 * The game's clock at the right of a section's bar (see game::subnav): its date and time, running at its pace in the
 * browser, and the paces to ask for. The pace in effect is solid and pulsing, the one the player asks for solid, the
 * rest outlined; the one asked for, clicked again, is no longer asked for.
 */
export default function clockBar(v: ViewContext): Html {
    const rate = Clock.rate();
    const mine = v.user ? Preferences.timeRate(v.user.id) : null;
    const pace = (r: number) => number_format(r, 2).replace(/0+$/, '').replace(/\.+$/, '');
    return html`
<div class="ms-auto py-1 text-end small game-clock">
    <div class="fw-semibold text-nowrap" data-game-clock="${Clock.time()}" data-game-rate="${rate}"
         title="The game's own time: ${pace(rate)} game ${rate == 1 ? 'day' : 'days'} for each real day">${gmdate('D j M Y, H:i:s', Clock.time())}</div>
    <form method="post" action="/game/pace" class="d-flex flex-wrap justify-content-end align-items-center gap-1 m-0">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <input type="hidden" name="back" value="${(v.path || '/game/home').replace(/\/+$/, '')}">
        <span class="text-body-secondary me-1">days per day</span>
        ${Clock.PACES.map((option) => {
            const effective = Math.abs(option - rate) < 1e-9;
            const asked = mine !== null && Math.abs(option - mine) < 1e-9;
            return html`
            <button class="${cls('btn btn-sm py-0 px-2', { 'btn-primary': effective || asked, 'pace-effective': effective, 'btn-outline-secondary': !effective && !asked })}"
                    name="time_rate" value="${asked ? '' : pace(option)}"
                    title="${effective ? 'The game runs at this pace (the slowest anyone asks for)' : ''}${effective && asked ? '; ' : ''}${asked ? 'You ask for this pace: click to stop asking' : (effective ? '' : 'Ask for this pace')}"
                    ${effective ? raw('aria-current="true"') : ''}>${pace(option)}</button>`;
        })}
    </form>
</div>
${v.once('clock-bar') ? html`
    ${v.push('styles', html`
        <style>
            .game-clock .pace-effective { animation: pace-pulse 1.6s ease-in-out infinite; }
            @keyframes pace-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(var(--bs-primary-rgb), .7); } 50% { box-shadow: 0 0 0 .3rem rgba(var(--bs-primary-rgb), 0); } }
            @media (prefers-reduced-motion: reduce) { .game-clock .pace-effective { animation: none; } }
        </style>`)}
    ${v.push('scripts', html`
        <script>
            // The clock runs on in the browser at the game's pace (game seconds per real second = its rate).
            document.querySelectorAll('[data-game-clock]').forEach((clock) => {
                const start = Number(clock.dataset.gameClock) * 1000;
                const rate = Number(clock.dataset.gameRate);
                const loaded = Date.now();
                const format = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
                const tick = () => {
                    const parts = Object.fromEntries(format.formatToParts(new Date(start + (Date.now() - loaded) * rate)).map((p) => [p.type, p.value]));
                    clock.textContent = \`\${parts.weekday} \${parts.day} \${parts.month} \${parts.year}, \${parts.hour}:\${parts.minute}:\${parts.second}\`;
                };
                tick();
                // Often enough that no game second is skipped at the game's pace (at 24, one every 1/24 s).
                setInterval(tick, Math.max(40, Math.min(1000, 1000 / rate)));
            });
        </script>`)}` : ''}`;
}
