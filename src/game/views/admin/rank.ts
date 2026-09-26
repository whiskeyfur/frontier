// Upstream: game/views/admin/rank.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Played } from '../../Played';
import { Ranks, type Rank } from '../../Ranks';
import gameLayout from '../layouts/game';

/** rank: the rank (Ranks.all()); holders: Ranks.holders(). */
export default function rank(v: ViewContext, { rank, holders }: { rank: Rank; holders: Row[] }): Html {
    return gameLayout(v, {
        title: rank.name + ' - Game admin',
        content: html`
    <p class="mb-2"><a href="/game/admin/ranks">&larr; Ranks</a></p>
    <h1 class="h3 mb-1">
        ${rank.name}${rank.female_name !== rank.name ? html` / ${rank.female_name}` : ''}
        ${rank.is_noble ? html`
            <span class="badge text-bg-primary align-middle">Noble</span>` : ''}
        ${rank.is_hereditary ? html`
            <span class="badge text-bg-secondary align-middle">Hereditary</span>` : ''}
    </h1>
    <p class="text-body-secondary">
        ${rank.is_hereditary ? html`
            Each holder's heir is the eldest free child who doesn't already rank as high; the title passes to them if
            the holder loses its freedom.` : html`
            Not hereditary: a holder that loses its freedom loses the title.`}
    </p>

    ${!holders.length ? html`
        <p>No one holds this title.</p>` : html`
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead>
                <tr>
                    <th>Holder</th><th>Title</th><th>Held since</th>
                    ${rank.is_hereditary ? html`
                        <th>Heir</th>` : ''}
                </tr>
                </thead>
                <tbody>
                ${holders.map((holder) => {
                    Played.note(holder.id, holder.name, holder.player_id);
                    return html`
                    <tr>
                        <td><a href="/game/assets/${holder.id}">${holder.name}</a></td>
                        <td>${Ranks.title(holder)}</td>
                        <td class="text-nowrap" data-sort="${holder.title_since}">${String(holder.title_since ?? '').substring(0, 10)}</td>
                        ${rank.is_hereditary ? html`
                            <td>
                                ${holder.successor ? (Played.note(holder.successor.id, holder.successor.name, holder.successor.player_id), html`
                                    <a href="/game/assets/${holder.successor.id}">${holder.successor.name}</a>
                                    <span class="text-body-secondary small">${Ranks.title(holder.successor)}</span>`) : html`
                                    <span class="text-body-secondary">none</span>`}
                            </td>` : ''}
                    </tr>`;
                })}
                </tbody>
            </table>
        </div>`}`,
    });
}
