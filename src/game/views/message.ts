// Upstream: game/views/message.blade.php
import { html, type Html } from '../../core/html';
import type { ViewContext } from '../../core/View';
import gameLayout from './layouts/game';

export default function message(v: ViewContext, { title, message }: { title: string; message: string }): Html {
    return gameLayout(v, {
        title,
        content: html`
    <h1 class="h3 mb-3">${title}</h1>
    <p>${message}</p>
    <a href="/game/home">Back to the game</a>`,
    });
}
