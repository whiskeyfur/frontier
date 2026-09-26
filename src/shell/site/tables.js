// Search, sort and paging for list tables: add data-sortable to a <table>. Clicking a header sorts by that column
// (again to reverse); a filter box under each header hides rows that don't contain its text. Columns whose <th> has
// data-nosort (checkboxes, buttons) are skipped. A cell's data-sort, if present, is sorted on instead of its text.
// Matching rows are shown a page at a time (PAGE_SIZES per page, the choice remembered in this browser); tables of
// MIN_PAGED rows or fewer aren't paged. Rows hidden by a filter or on another page are unticked, so actions on
// "selected" rows never touch rows you can't see.
(() => {
    const PAGE_SIZES = [10, 25, 50, 100, 250];
    const DEFAULT_PAGE_SIZE = 50;
    const MIN_PAGED = 10;
    const STORAGE_KEY = 'tables.perPage';

    const storedPageSize = () => {
        try {
            const size = parseInt(localStorage.getItem(STORAGE_KEY), 10);
            return PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE;
        } catch {
            return DEFAULT_PAGE_SIZE;
        }
    };
    const blank = (text) => text === '' || text === '—' || text === '-' || /^unknown$/i.test(text);
    const numberAt = (text) => {
        const match = text.match(/^[+-]?\d[\d,]*(\.\d+)?/);
        return match ? parseFloat(match[0].replace(/,/g, '')) : null;
    };
    const sortValue = (cell) => (cell?.dataset.sort ?? cell?.textContent ?? '').replace(/\s+/g, ' ').trim();

    function compare(a, b) {
        if (blank(a) || blank(b)) {
            return blank(a) - blank(b); // blanks last
        }
        // Dates (YYYY-MM-DD...) compare as text; otherwise a leading number compares as a number.
        if (!/^\d{4}-\d{2}-\d{2}/.test(a) && !/^\d{4}-\d{2}-\d{2}/.test(b)) {
            const [x, y] = [numberAt(a), numberAt(b)];
            if (x !== null && y !== null && x !== y) {
                return x - y;
            }
        }
        return a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'});
    }

    function enhance(table) {
        const headerRow = table.tHead?.rows[0];
        const body = table.tBodies[0];
        if (!headerRow || !body) {
            return;
        }
        const headers = [...headerRow.cells];
        let page = 1;
        let perPage = storedPageSize();

        // Search: a box under each column's header.
        const filterRow = table.tHead.insertRow();
        filterRow.className = 'table-filters';
        const filters = headers.map((th, column) => {
            const cell = document.createElement('th');
            filterRow.appendChild(cell);
            if ('nosort' in th.dataset) {
                return null;
            }
            const input = document.createElement('input');
            input.type = 'search';
            input.className = 'form-control form-control-sm';
            input.placeholder = 'Search';
            input.setAttribute('aria-label', `Search ${th.textContent.trim() || 'column ' + (column + 1)}`);
            input.addEventListener('input', applyFilters);
            cell.appendChild(input);
            return input;
        });

        function applyFilters() {
            const terms = filters.map((input) => input?.value.trim().toLowerCase() || '');
            for (const row of body.rows) {
                const matches = terms.every((term, column) =>
                    !term || (row.cells[column]?.textContent || '').toLowerCase().includes(term));
                row.dataset.filteredOut = matches ? '' : '1';
            }
            page = 1;
            render();
        }

        // Paging: the controls go under the table (or its scrolling wrapper).
        const controls = document.createElement('div');
        controls.className = 'd-flex flex-wrap align-items-center justify-content-between gap-2 small mt-2 mb-3 table-paging';
        controls.innerHTML = `
            <span class="text-body-secondary" data-range></span>
            <div class="d-flex flex-wrap align-items-center gap-2">
                <label class="d-flex align-items-center gap-1 m-0">
                    <select class="form-select form-select-sm w-auto" data-per-page aria-label="Rows per page">
                        ${PAGE_SIZES.map((size) => `<option value="${size}">${size}</option>`).join('')}
                    </select>
                    <span class="text-body-secondary">per page</span>
                </label>
                <nav aria-label="Pages"><ul class="pagination pagination-sm m-0" data-pages></ul></nav>
            </div>`;
        (table.closest('.table-responsive') ?? table).after(controls);
        const perPageSelect = controls.querySelector('[data-per-page]');
        perPageSelect.value = String(perPage);
        perPageSelect.addEventListener('change', () => {
            perPage = parseInt(perPageSelect.value, 10);
            try {
                localStorage.setItem(STORAGE_KEY, String(perPage));
            } catch {
                // Not remembered (private window, blocked storage); it still applies here.
            }
            page = 1;
            render();
        });
        controls.querySelector('[data-pages]').addEventListener('click', (event) => {
            const link = event.target.closest('[data-page]');
            if (link) {
                event.preventDefault();
                page = parseInt(link.dataset.page, 10);
                render();
            }
        });

        // Page links: Prev, the first, the last, two either side of the current one (gaps shown as …), Next.
        function pageLinks(pages) {
            const wanted = [...new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2])]
                .filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
            const step = (label, target, enabled) => `<li class="page-item${enabled ? '' : ' disabled'}">`
                + `<a class="page-link" href="#"${enabled ? ` data-page="${target}"` : ' tabindex="-1" aria-disabled="true"'}>${label}</a></li>`;
            let links = step('‹ Prev', page - 1, page > 1);
            let previous = 0;
            for (const p of wanted) {
                if (p - previous > 1) {
                    links += '<li class="page-item disabled"><span class="page-link">…</span></li>';
                }
                links += `<li class="page-item${p === page ? ' active' : ''}"><a class="page-link" href="#" data-page="${p}"`
                    + `${p === page ? ' aria-current="page"' : ''}>${p}</a></li>`;
                previous = p;
            }
            return links + step('Next ›', page + 1, page < pages);
        }

        function hide(row, hidden) {
            row.hidden = hidden;
            if (hidden) {
                row.querySelectorAll('input[type="checkbox"]:checked').forEach((box) => {
                    box.checked = false;
                    box.dispatchEvent(new Event('change', {bubbles: true}));
                });
            }
        }

        // Shows the current page of matching rows and updates the controls.
        function render() {
            const rows = [...body.rows];
            const matching = rows.filter((row) => row.dataset.filteredOut !== '1');
            const paged = rows.length > MIN_PAGED;
            const size = paged ? perPage : Math.max(matching.length, 1);
            const pages = Math.max(1, Math.ceil(matching.length / size));
            page = Math.min(Math.max(page, 1), pages);
            const start = (page - 1) * size;
            let index = 0;
            for (const row of rows) {
                if (row.dataset.filteredOut === '1') {
                    hide(row, true);
                    continue;
                }
                hide(row, index < start || index >= start + size);
                index++;
            }
            controls.hidden = !paged;
            const shown = matching.length
                ? `${(start + 1).toLocaleString()}–${Math.min(start + size, matching.length).toLocaleString()}`
                : '0';
            controls.querySelector('[data-range]').textContent = `Showing ${shown} of ${matching.length.toLocaleString()}`
                + (matching.length < rows.length ? ` (filtered from ${rows.length.toLocaleString()})` : '');
            controls.querySelector('[data-pages]').innerHTML = pages > 1 ? pageLinks(pages) : '';
            table.dispatchEvent(new CustomEvent('table:filtered', {bubbles: true}));
        }

        // Sort: click (or Enter/Space on) a header.
        let sorted = {column: -1, direction: 1};
        headers.forEach((th, column) => {
            if ('nosort' in th.dataset) {
                return;
            }
            th.style.cursor = 'pointer';
            th.style.userSelect = 'none';
            th.tabIndex = 0;
            th.title = 'Sort';
            const sort = () => {
                sorted = {column, direction: sorted.column === column ? -sorted.direction : 1};
                const rows = [...body.rows];
                rows.sort((a, b) => {
                    const [x, y] = [sortValue(a.cells[column]), sortValue(b.cells[column])];
                    // Blanks stay last whichever way the column is sorted.
                    return blank(x) || blank(y) ? compare(x, y) : sorted.direction * compare(x, y);
                });
                rows.forEach((row) => body.appendChild(row));
                headers.forEach((other, i) => {
                    other.removeAttribute('aria-sort');
                    other.querySelector('.sort-arrow')?.remove();
                    if (i === column) {
                        other.setAttribute('aria-sort', sorted.direction > 0 ? 'ascending' : 'descending');
                        other.insertAdjacentHTML('beforeend',
                            `<span class="sort-arrow small ms-1">${sorted.direction > 0 ? '▲' : '▼'}</span>`);
                    }
                });
                page = 1;
                render();
            };
            th.addEventListener('click', sort);
            th.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    sort();
                }
            });
        });

        render();
    }

    document.querySelectorAll('table[data-sortable]').forEach(enhance);
})();
