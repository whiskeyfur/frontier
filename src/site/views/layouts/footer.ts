// Upstream: views/layouts/footer.blade.php
//
// Upstream's footer also links the site's privacy policy (/docs/privacy), which isn't part of this port (nothing leaves
// the browser here).
import { html, type Html } from '../../../core/html';
import { gmdate } from '../../../core/php';

/**
 * The footer on every page: fixed to the bottom of the window. The page is padded below by its height plus a few
 * lines, so the end of the content never sits under it. The layouts' header (.site-header) sticks to the top, and on a
 * wide screen an app's second navigation bar (.site-subnav) under it; jumping to an anchor stops below them.
 */
export default function footer(): Html {
    return html`
<footer class="site-footer fixed-bottom border-top bg-body-tertiary small text-body-secondary py-2">
    <div class="container d-flex flex-wrap justify-content-between gap-2">
        <span>&copy; ${gmdate('Y')} Frontier</span>
        <a class="link-secondary" href="#top" onclick="window.scrollTo({ top: 0, behavior: 'smooth' }); return false;">Back to top</a>
    </div>
</footer>
<style>
    body { padding-bottom: calc(var(--site-footer-height, 2.5rem) + 5.5rem); }
    html { scroll-padding-top: calc(var(--site-header-height, 0px) + var(--site-subnav-height, 0px) + 1rem); }
    /* Opened on a narrow screen, the header's menu scrolls within the window (the header doesn't scroll away). */
    @media (max-width: 991.98px) {
        .site-header .navbar-collapse { max-height: calc(100vh - 4.5rem); overflow-y: auto; }
    }
    /* An app's second navigation bar sits right under the header (the header's margin goes below it instead) and sticks
       there on a wide screen; on a phone it's hidden (d-none d-md-block). The page it's on is marked by an underline. */
    .site-subnav .nav-link.active { box-shadow: inset 0 -3px 0 var(--bs-primary); }
    @media (min-width: 768px) {
        .site-header:has(+ .site-subnav) { margin-bottom: 0 !important; }
        .site-subnav { position: sticky; top: var(--site-header-height, 0px); z-index: 1019; }
    }
</style>
<script>
    // The padding follows the footer's, header's and second bar's real heights (they wrap on a narrow screen).
    (() => {
        const footer = document.querySelector('.site-footer');
        const header = document.querySelector('.site-header');
        const subnav = document.querySelector('.site-subnav');
        const fit = () => {
            document.body.style.setProperty('--site-footer-height', footer.offsetHeight + 'px');
            document.documentElement.style.setProperty('--site-header-height', (header ? header.offsetHeight : 0) + 'px');
            const stuck = subnav && getComputedStyle(subnav).position === 'sticky';
            document.documentElement.style.setProperty('--site-subnav-height', (stuck ? subnav.offsetHeight : 0) + 'px');
        };
        fit();
        window.addEventListener('resize', fit);
    })();
</script>`;
}
