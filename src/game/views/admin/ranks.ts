// Upstream: game/views/admin/ranks.blade.php
import { checked, disabled, html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import { Ranks, type Rank } from '../../Ranks';
import gameLayout from '../layouts/game';

/** ranks: Ranks.all(); counts: Ranks.counts() (rank => how many hold it). */
export default function ranks(v: ViewContext, { ranks, counts, error }: {
    ranks: Map<number, Rank>; counts: Map<number, number>; error: string | null;
}): Html {
    return gameLayout(v, {
        title: 'Ranks - Game admin',
        content: html`
    <h1 class="h3 mb-1">Ranks</h1>
    <p class="text-body-secondary mb-1">
        Ranks run from the crown down to slave; the order is fixed, but you can rename each (anthros that present as
        female get the female title). Titles, from ${Ranks.name(Ranks.KNIGHT)} up, are granted on the
        Court page.
    </p>
    <ul class="text-body-secondary small">
        <li><strong>Noble</strong> ranks are the peerage. Players can't become an anthro of a noble rank; only admins can.</li>
        <li>
            A <strong>hereditary</strong> title passes to its holder's eldest free child when the holder loses its
            freedom. Other titles are lost. Titles the crown takes away are never inherited.
        </li>
        <li>Commoners and slaves are neither.</li>
    </ul>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}

    <div class="table-responsive">
        <table class="table align-middle">
            <thead>
            <tr><th>Rank</th><th>Title</th><th>Female title</th><th>Noble</th><th>Hereditary</th><th class="text-end">Held by</th><th></th></tr>
            </thead>
            <tbody>
            ${[...ranks.values()].map((rank) => {
                const titled = rank.rank >= Ranks.KNIGHT;
                return html`
                <tr>
                    <td class="text-body-secondary">${rank.rank}</td>
                    <td>
                        <input class="form-control form-control-sm" form="rank-${rank.rank}" name="name" value="${rank.name}"
                               maxlength="${Ranks.MAX_NAME}" required aria-label="Title">
                    </td>
                    <td>
                        <input class="form-control form-control-sm" form="rank-${rank.rank}" name="female_name" value="${rank.female_name}"
                               maxlength="${Ranks.MAX_NAME}" aria-label="Female title" placeholder="Same as the title">
                    </td>
                    <td>
                        <input class="form-check-input" type="checkbox" form="rank-${rank.rank}" name="is_noble" aria-label="Noble"
                               ${checked(rank.is_noble)} ${disabled(!titled)}>
                    </td>
                    <td>
                        <input class="form-check-input" type="checkbox" form="rank-${rank.rank}" name="is_hereditary" aria-label="Hereditary"
                               ${checked(rank.is_hereditary)} ${disabled(!titled)}>
                    </td>
                    <td class="text-end">
                        ${titled ? html`
                            <a href="/game/admin/ranks/${rank.rank}">${counts.get(rank.rank)}</a>` : html`
                            ${counts.get(rank.rank)}`}
                    </td>
                    <td class="text-end">
                        <form method="post" action="/game/admin/ranks" id="rank-${rank.rank}" class="m-0">
                            <input type="hidden" name="csrf" value="${v.csrf}">
                            <input type="hidden" name="rank" value="${rank.rank}">
                            <button class="btn btn-sm btn-outline-primary">Save</button>
                        </form>
                    </td>
                </tr>`;
            })}
            </tbody>
        </table>
    </div>`,
    });
}
