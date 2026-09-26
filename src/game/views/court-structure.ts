// Upstream: game/views/court-structure.blade.php
import { html, type Html } from '../../core/html';
import { array_unique } from '../../core/php';
import type { ViewContext } from '../../core/View';
import { Ranks } from '../Ranks';
import courtNode from './court/node';
import gameLayout from './layouts/game';
import subnav from './subnav';

export default function courtStructure(v: ViewContext, { court }: { court: ReturnType<typeof Ranks.structure> }): Html {
    return gameLayout(v, {
        title: 'Court structure - Game',
        content: html`
    <h1 class="h3 mb-3">Court</h1>
    ${subnav(v, { section: '/game/court' })}
    <p class="text-body-secondary">
        Who is sworn to whom, from the crown down. Every commoner is sworn to a titled anthro, and every owned anthro to
        its owner. Each title holder shows how many commoners have sworn fealty to them (and how many anthros they own). Open a
        branch to see who is sworn below.
    </p>

    <div class="d-flex flex-wrap gap-2 mb-4">
        ${[...court.ranks].map(([rank, count]) => html`
            <span class="badge text-bg-light border">${array_unique([Ranks.name(rank), Ranks.name(rank, 'female')]).join('/')}: ${count}</span>`)}
        <span class="badge text-bg-light border">Commoners sworn to a title holder: ${court.sworn}</span>
        <span class="badge text-bg-light border">Commoners sworn to no one: ${court.unsworn}</span>
        <span class="badge text-bg-light border">Owned anthros (sworn to their owners): ${court.owned}</span>
    </div>

    ${!court.roots.length ? html`
        <p>No one holds a title yet.</p>` : html`
        <ul class="list-unstyled">
            ${court.roots.map((node) => courtNode(v, { node }))}
        </ul>`}`,
    });
}
