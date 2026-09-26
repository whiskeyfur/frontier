// Upstream: views/docs/knowledge-base-body.blade.php
import { cls, html, raw, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import type { DocsEntry } from '../../Docs';

/**
 * A Knowledge Base (see Docs.render): its html, with its contents alongside on a wide screen.
 */
export default function knowledgeBaseBody(_v: ViewContext, { html: body, contents }: { html: string; contents: DocsEntry[] }): Html {
    return html`<div class="row g-4">
    <nav class="col-lg-3 order-lg-last" aria-label="Contents">
        <div class="kb-contents small">
            <h2 class="h6 text-body-secondary text-uppercase mb-2">Contents</h2>
            <ul class="list-unstyled mb-0">
                ${contents.map((entry) => html`
                    <li class="${cls({ 'ps-3': entry.level === 3, 'mt-2 fw-semibold': entry.level === 2 })}"><a class="link-body-emphasis link-underline-opacity-0 link-underline-opacity-75-hover" href="#${entry.id}">${entry.text}</a></li>`)}
            </ul>
        </div>
    </nav>
    <div class="col-lg-9">
        <div class="knowledge-base" style="max-width: 48rem">${raw(body)}</div>
    </div>
</div>
<style>
    /* On a wide screen the contents stay in view, under the header and the section's bar. */
    @media (min-width: 992px) {
        .kb-contents { position: sticky; top: calc(var(--site-header-height, 0px) + var(--site-subnav-height, 0px) + 1rem);
            max-height: calc(100vh - var(--site-header-height, 0px) - var(--site-subnav-height, 0px) - 6rem); overflow-y: auto;
            scrollbar-width: thin; scrollbar-color: var(--bs-secondary-bg) transparent; }
    }
    .knowledge-base h2 { font-size: 1.4rem; margin-top: 2rem; padding-bottom: .25rem; border-bottom: 1px solid var(--bs-border-color); }
    .knowledge-base h2:first-of-type { margin-top: 0; }
    .knowledge-base h3 { margin-top: 1.5rem; font-size: 1.1rem; }
    .knowledge-base table { width: auto; margin-bottom: 1rem; }
    .knowledge-base th, .knowledge-base td { padding: .25rem .75rem .25rem 0; border-bottom: 1px solid var(--bs-border-color); vertical-align: top; }
</style>`;
}
