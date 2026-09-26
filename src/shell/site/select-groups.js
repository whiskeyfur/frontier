// "Select all" and a selected count for each <form data-select-group> of checkboxes named ids[].
// Rows (<tr> or <li>) a table filter or paging has hidden don't count (tables.js unticks rows it hides), so "select
// all" means all on the page shown.
document.querySelectorAll('form[data-select-group]').forEach((form) => {
    const boxes = () => [...form.querySelectorAll('input[name="ids[]"]')].filter((box) => !box.closest('tr, li')?.hidden);
    const all = form.querySelector('[data-select-all]');
    const count = form.querySelector('[data-selected-count]');
    const update = () => {
        const checked = boxes().filter((box) => box.checked).length;
        count.textContent = checked ? `(${checked})` : '';
        all.checked = checked > 0 && checked === boxes().length;
        all.indeterminate = checked > 0 && checked < boxes().length;
    };
    form.addEventListener('table:filtered', update);
    all.addEventListener('change', () => { boxes().forEach((box) => { box.checked = all.checked; }); update(); });
    form.addEventListener('change', (event) => { if (event.target.name === 'ids[]') update(); });
});
