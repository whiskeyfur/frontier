// Upstream: game/views/court/marriage.blade.php
import { html, type Html } from '../../../core/html';
import { int, json_encode } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Ranks } from '../../Ranks';

// The player's marriage (see Marriages): the household it heads or married into, proposals, and proposing.
export default function marriage(v: ViewContext, { player, spouses, proposals }: {
    player: Row; spouses: Row[]; proposals: { received: Row[]; sent: Row[] };
}): Html {
    return html`<h3 class="h6 mt-3">Marriage</h3>
${player.spouse_of ? html`
    <p class="mb-2">
        Married into <a href="/game/assets/${player.spouse_of}">${player.spouse_of_name}</a>'s household${Ranks.isConsort(player) ? ': ' + Ranks.title(player) + ' by marriage' : ''}.
    </p>
    <form method="post" action="/game/court" class="mb-2">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <input type="hidden" name="action" value="leave">
        <button class="btn btn-sm btn-outline-danger"
                onclick="return confirm(${json_encode('Leave ' + player.spouse_of_name + "'s household? You lose any rank you share by marriage, and your land no longer counts toward theirs, which can cost them their title.")})">Leave the household</button>
    </form>` : spouses.length ? html`
    <p class="mb-1">Married into your household, sharing your rank:</p>
    <ul class="list-unstyled mb-2">
        ${spouses.map((spouse) => html`
            <li class="d-flex flex-wrap align-items-center gap-2 mb-1">
                <a href="/game/assets/${spouse.id}">${spouse.name}</a>
                <span class="small text-body-secondary">${Ranks.title(spouse)}</span>
                <form method="post" action="/game/court" class="m-0">
                    <input type="hidden" name="csrf" value="${v.csrf}">
                    <input type="hidden" name="action" value="dismiss">
                    <input type="hidden" name="spouse_id" value="${spouse.id}">
                    <button class="btn btn-sm btn-outline-secondary"
                            onclick="return confirm(${json_encode('Send ' + spouse.name + ' away? Their land no longer counts toward your rank, which can cost you your title.')})">Send away</button>
                </form>
            </li>`)}
    </ul>` : html`
    <p class="text-body-secondary small mb-2">Not married.</p>`}

${proposals.received.map((proposal) => html`
    <form method="post" action="/game/court" class="d-flex flex-wrap align-items-center gap-2 mb-2">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <input type="hidden" name="proposal_id" value="${proposal.id}">
        <span>
            <a href="/game/assets/${proposal.other.id}">${proposal.other.name}</a>
            (${Ranks.title(proposal.other)})
            ${int(proposal.head_id) === player.id ? 'asks to marry into your household.' : 'asks you to marry into their household.'}
        </span>
        <button class="btn btn-sm btn-outline-success" name="action" value="accept">Accept</button>
        <button class="btn btn-sm btn-outline-secondary" name="action" value="decline">Decline</button>
    </form>`)}
${proposals.sent.map((proposal) => html`
    <form method="post" action="/game/court" class="d-flex flex-wrap align-items-center gap-2 mb-2">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <input type="hidden" name="proposal_id" value="${proposal.id}">
        <span class="small">
            You proposed to ${proposal.other.name}
            ${int(proposal.head_id) === player.id ? 'to marry into your household' : 'to marry into their household'}: waiting for an answer.
        </span>
        <button class="btn btn-sm btn-outline-secondary" name="action" value="withdraw">Take it back</button>
    </form>`)}

${!player.spouse_of ? html`
    <form method="post" action="/game/court" class="d-flex flex-wrap align-items-center gap-2 mb-2">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <input type="hidden" name="action" value="propose">
        <input class="form-control w-auto" name="anthro" list="spouse-names" data-anthro-search placeholder="Name (#id)"
               aria-label="Who to propose to" required>
        <datalist id="spouse-names"></datalist>
        <select class="form-select w-auto" name="into" aria-label="Whose household">
            <option value="mine">to marry into my household</option>
            ${!spouses.length ? html`
                <option value="theirs">to marry into theirs</option>` : ''}
        </select>
        <button class="btn btn-outline-primary">Propose</button>
    </form>
    <div class="form-text mb-2">
        A household has one head and any number of spouses, who share the head's rank; the household's land counts toward
        the head's. Anyone can leave, or be sent away, but a title earned by land is lost if the land goes with them.
    </div>` : ''}
`;
}
