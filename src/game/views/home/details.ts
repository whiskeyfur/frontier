// Upstream: game/views/home/details.blade.php
import { html, json, selected, type Html } from '../../../core/html';
import type { InputArray } from '../../../core/http';
import { empty, gmdate, int, strtotimeOrThrow } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Anthros } from '../../Anthros';
import { Species } from '../../Species';
import nameInput from '../assets/name-input';

export type HomeForm = { name: string; gender_id: number; species_id: number; birthdate: string };

/**
 * Creating an anthro to play, or (admins, from the admin panel) changing everything about the one you play.
 * prefix keeps field ids unique on the page. post is the request's form ($_POST upstream).
 */
export default function details(v: ViewContext, { prefix, player, form, genders, gameEmpty, post }: {
    prefix: string; player: Row | null; form: HomeForm; genders: Row[]; gameEmpty: boolean; post: InputArray;
}): Html {
    const starter = post.starter ?? '';
    return html`<form method="post" action="/game/home" class="mb-3">
    <input type="hidden" name="csrf" value="${v.csrf}">
    <div class="row g-2 mb-2">
        <div class="col-12">
            <label class="form-label small" for="${prefix}name">Name</label>
            ${nameInput(v, { id: prefix + 'name', value: form.name, genderField: 'gender_id' })}
        </div>
        <div class="col-sm-6">
            <label class="form-label small" for="${prefix}gender_id">Gender</label>
            <select class="form-select" id="${prefix}gender_id" name="gender_id" required>
                <option value="">Choose your gender</option>
                ${genders.map((gender) => html`
                    <option value="${gender.id}" data-sires="${int(gender.is_male)}" data-carries="${int(gender.is_female)}"
                            ${selected(form.gender_id === gender.id)}>${gender.name}</option>`)}
            </select>
        </div>
        <div class="col-sm-6">
            <label class="form-label small" for="${prefix}species_id">Species</label>
            <select class="form-select" id="${prefix}species_id" name="species_id" required>
                <option value="">Choose your species</option>
                ${[...Species.grouped()].map(([group, options]) => html`
                    <optgroup label="${group}">
                        ${[...options].map(([speciesId, speciesName]) => html`
                            <option value="${speciesId}" ${selected(form.species_id === speciesId)}>${speciesName}</option>`)}
                    </optgroup>`)}
            </select>
        </div>
        <div class="col-sm-6">
            <label class="form-label small" for="${prefix}birthdate">Birthdate <span class="text-body-secondary">(optional)</span></label>
            <input class="form-control" id="${prefix}birthdate" name="birthdate" type="date" value="${form.birthdate}"
                   min="${gmdate('Y-m-d', strtotimeOrThrow('-' + (Anthros.LIFESPAN_MIN * 7 - 1) + ' days'))}" max="${gmdate('Y-m-d')}">
            ${!player ? html`
                <div class="form-text">Leave it empty to start just grown: fertile from today.</div>` : ''}
        </div>
    </div>
    ${!player && !empty(gameEmpty) ? html`
        ${/* The game's very first anthro can start with a slave to breed with (Anthros.createStarterSlave). */ ''}
        <div class="mb-3">
            <label class="form-label small" for="${prefix}starter">A slave to breed with <span class="text-body-secondary">(optional)</span></label>
            <select class="form-select" id="${prefix}starter" name="starter" data-starter-for="${prefix}gender_id">
                <option value="">No, just my anthro</option>
                <option value="mate" data-needs="one-sex" ${selected(starter === 'mate')}>Yes, of the opposite sex</option>
                <option value="sire" data-needs="carries" ${selected(starter === 'sire')}>Yes, one that sires</option>
                <option value="dam" data-needs="sires" ${selected(starter === 'dam')}>Yes, one that carries</option>
            </select>
            <div class="form-text">
                There's no one else in the game yet, so you can start with a slave of your species and your very age,
                owned by your anthro: one it can breed with, so the choices follow your gender.
            </div>
        </div>
        ${/* Only the choices the chosen gender can breed with: a slave that sires needs one that carries, and the other
             way round; "the opposite sex" needs a gender that does just one (a herm has no opposite: it picks). A
             gender that can't breed gets none. */ ''}
        <script>
            (() => {
                const starter = document.getElementById(${json(prefix + 'starter')});
                const gender = document.getElementById(starter.dataset.starterFor);
                const update = () => {
                    const chosen = gender.selectedOptions[0];
                    const can = {sires: chosen?.dataset.sires === '1', carries: chosen?.dataset.carries === '1'};
                    const known = Boolean(chosen?.value);
                    for (const option of starter.options) {
                        const needs = option.dataset.needs;
                        option.disabled = known && Boolean(needs) && (needs === 'one-sex' ? can.sires === can.carries : !can[needs]);
                    }
                    if (starter.selectedOptions[0]?.disabled) {
                        starter.value = '';
                    }
                };
                gender.addEventListener('change', update);
                update();
            })();
        </script>` : ''}
    <button class="btn btn-primary">${player ? 'Save changes' : 'Create my anthro'}</button>
</form>`;
}
