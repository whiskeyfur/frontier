// Upstream: game/views/wallet.blade.php
import { html, type Html } from '../../core/html';
import { int, number_format } from '../../core/php';
import type { ViewContext } from '../../core/View';
import type { Row } from '../../db/Db';
import { Wallets } from '../Wallets';
import gameLayout from './layouts/game';
import subnav from './subnav';

export default function wallet(v: ViewContext, { player, balance = 0, held = 0, ledger = [] }: {
    player: Row | null; balance?: number; held?: number; ledger?: Row[];
}): Html {
    return gameLayout(v, {
        title: 'Wallet - Game',
        content: html`
    <h1 class="h3 mb-3">Wallet${player ? ': ' + player.name : ''}</h1>
    ${subnav(v, { section: '/game/wallet' })}
    ${!player ? html`
        <p>Coins belong to anthros. <a href="/game/home">Create or become an anthro</a> to get a wallet.</p>` : html`
    <div class="row g-3 mb-4">
        <div class="col-sm-6 col-lg-4">
            <div class="card card-body">
                <div class="text-body-secondary small">Balance</div>
                <div class="fs-3">${Wallets.format(balance)}</div>
            </div>
        </div>
        <div class="col-sm-6 col-lg-4">
            <div class="card card-body">
                <div class="text-body-secondary small">In your winning bids</div>
                <div class="fs-3">${Wallets.format(held)}</div>
                <div class="small text-body-secondary">Already taken from your balance; returned if you're outbid.</div>
            </div>
        </div>
    </div>
    <h2 class="h5">History</h2>
    <div class="table-responsive">
        <table data-sortable class="table table-striped align-middle">
            <thead>
            <tr><th>When (UTC)</th><th>What</th><th class="text-end">Amount</th><th class="text-end">Balance</th></tr>
            </thead>
            <tbody>
            ${ledger.map((entry) => html`
                <tr>
                    <td class="text-nowrap">${String(entry.created_at).substring(0, 16)}</td>
                    <td>
                        ${entry.auction_id ? html`
                            <a href="/game/market/auctions/${entry.auction_id}">${entry.reason}</a>` : html`
                            ${entry.reason}`}
                    </td>
                    <td class="text-end ${entry.amount < 0 ? 'text-danger-emphasis' : 'text-success'}">
                        ${entry.amount > 0 ? '+' : ''}${number_format(int(entry.amount))}
                    </td>
                    <td class="text-end">${number_format(int(entry.balance_after))}</td>
                </tr>`)}
            </tbody>
        </table>
    </div>`}`,
    });
}
