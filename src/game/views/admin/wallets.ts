// Upstream: game/views/admin/wallets.blade.php
import { html, type Html } from '../../../core/html';
import { int } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Wallets } from '../../Wallets';
import gameLayout from '../layouts/game';
import listSearch from '../list-search';

/** wallets: Wallets.all(q, App.LIST_LIMIT); total: Wallets.countAll(q). */
export default function wallets(v: ViewContext, { wallets, total, q, error }: { wallets: Row[]; total: number; q: string; error: string | null }): Html {
    return gameLayout(v, {
        title: 'Wallets - Game admin',
        content: html`
    <h1 class="h3 mb-1">Wallets</h1>
    <p class="text-body-secondary">
        Coins belong to anthros. Players spend from the anthro they play. Listed: every played anthro, and any other
        anthro holding coins.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    ${listSearch(v, { action: '/game/admin/wallets', q, shown: wallets.length, total })}
    <div class="table-responsive">
        <table data-sortable class="table table-striped align-middle">
            <thead>
            <tr><th>Anthro</th><th>Played by</th><th>Owner</th><th class="text-end">Balance</th><th class="text-end">In bids</th><th data-nosort>Adjust</th></tr>
            </thead>
            <tbody>
            ${wallets.map((wallet) => html`
                <tr>
                    <td><a href="/game/assets/${wallet.id}">${wallet.name}</a></td>
                    <td>${wallet.player_name ?? '—'}</td>
                    <td>${wallet.owner_name ?? 'free'}</td>
                    <td class="text-end" data-sort="${wallet.balance}">${Wallets.format(int(wallet.balance))}</td>
                    <td class="text-end" data-sort="${wallet.held}">${Wallets.format(int(wallet.held))}</td>
                    <td>
                        <form method="post" action="/game/admin/wallets" class="d-flex flex-wrap gap-2">
                            <input type="hidden" name="csrf" value="${v.csrf}">
                            <input type="hidden" name="anthro_id" value="${wallet.id}">
                            <input class="form-control form-control-sm" style="width: 7rem" name="amount" type="number"
                                   placeholder="+/- coins" required aria-label="Amount">
                            <input class="form-control form-control-sm w-auto flex-grow-1" name="reason" maxlength="200"
                                   placeholder="Reason" required aria-label="Reason">
                            <button class="btn btn-sm btn-outline-warning">Apply</button>
                        </form>
                    </td>
                </tr>`)}
            </tbody>
        </table>
    </div>`,
    });
}
