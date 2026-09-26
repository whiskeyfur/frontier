// Upstream: game/views/court-lands.blade.php
import { html, type Html } from '../../core/html';
import type { ViewContext } from '../../core/View';
import type { Row } from '../../db/Db';
import { Baronies } from '../Baronies';
import { Ranks } from '../Ranks';
import baronyLine from './court/barony-line';
import landsNode from './court/lands-node';
import gameLayout from './layouts/game';
import subnav from './subnav';

export default function courtLands(v: ViewContext, { realm }: { realm: { roots: Row[]; unheld: Row[] } }): Html {
    return gameLayout(v, {
        title: 'Lands - Game',
        content: html`
    <h1 class="h3 mb-3">Court</h1>
    ${subnav(v, { section: '/game/court' })}
    <p class="text-body-secondary">
        The realm's land, by barony. A barony is held and managed by a ${Ranks.name(Baronies.HOLDER_RANK)}
        (or held directly by a higher lord, as the crown holds its own), and through them by every lord they're sworn
        to, up to the crown. Its villages, manors and expanses are each managed by a
        ${Ranks.name(Ranks.KNIGHT)} or higher, and its towns and cities by a ${Ranks.name(3)} or higher. The land in it can belong to anyone.
    </p>

    ${!realm.roots.length && !realm.unheld.length ? html`
        <p>There are no baronies yet.</p>` : html`
        <ul class="list-unstyled">
            ${realm.roots.map((node) => landsNode(v, { node }))}
        </ul>
        ${realm.unheld.length ? html`
            <h2 class="h5 mt-4">Held by no one</h2>
            <ul class="list-unstyled">
                ${realm.unheld.map((barony) => html`
                    <li>${baronyLine(v, { barony })}</li>`)}
            </ul>` : ''}`}`,
    });
}
