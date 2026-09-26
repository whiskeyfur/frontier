// Upstream: game/views/preferences.blade.php
import { checked, html, type Html } from '../../core/html';
import type { ViewContext } from '../../core/View';
import { Preferences } from '../Preferences';
import { Schedules } from '../Schedules';
import gameLayout from './layouts/game';
import subnav from './subnav';

export default function preferences(v: ViewContext, { era, error }: { era: string; error: string | null }): Html {
    return gameLayout(v, {
        title: 'Preferences - Game',
        content: html`
    <h1 class="h3 mb-3">Preferences</h1>
    ${subnav(v, { section: '/game/home' })}
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    <form method="post" action="/game/preferences" class="card card-body" style="max-width: 40rem">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <h2 class="h5">Era</h2>
        <p class="text-body-secondary small">The age you play in. It applies to what you do: what you schedule, breed and flirt.</p>
        <div class="form-check mb-2">
            <input class="form-check-input" type="radio" name="era" value="dark" id="era-dark" ${checked(era === 'dark')}>
            <label class="form-check-label" for="era-dark">
                <strong>${Preferences.ERAS['dark']}</strong>
                <span class="d-block small text-body-secondary">The trades of field, forge and hearth. Anthros can be bred as soon as they're fertile.</span>
            </label>
        </div>
        <div class="form-check mb-3">
            <input class="form-check-input" type="radio" name="era" value="renaissance" id="era-renaissance" ${checked(era === 'renaissance')}>
            <label class="form-check-label" for="era-renaissance">
                <strong>${Preferences.ERAS['renaissance']}</strong>
                <span class="d-block small text-body-secondary">
                    The arts flourish: ${Object.keys(Schedules.RENAISSANCE_SKILLS).join(', ')} to train and work at
                    (${Object.values({ ...Schedules.RENAISSANCE_SKILLS, ...Schedules.RENAISSANCE_TITLES }).flat().join(', ')}).
                    No anthro younger than ${Preferences.MIN_BREEDING_WEEKS['renaissance']} weeks may be bred.
                </span>
            </label>
        </div>
        <div><button class="btn btn-primary">Save</button></div>
    </form>`,
    });
}
