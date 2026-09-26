#!/usr/bin/env node
// End-to-end check of the built file (dist/index.html) in headless Chromium, opened from the disk (file://) as a
// player would: the first visit, making an anthro, every page in the menus and the admin panel, and that the game is
// still there after reloading. Fails on any page error, console error, or error box.
//
//   npm run build && npm run e2e
//
// Needs Playwright's Chromium: `npx playwright install chromium`.
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const file = path.resolve(__dirname, '../dist/index.html');
const problems = [];

async function main() {
    if (!fs.existsSync(file)) throw new Error('No dist/index.html: run npm run build first.');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'frontier-e2e-'));
    let context = await chromium.launchPersistentContext(profile, { headless: true });
    try {
        let page = await open(context);
        await page.goto('file://' + file);

        // The first visit: choose a name.
        await page.waitForSelector('input[name="username"]');
        await page.fill('input[name="username"]', 'Tester');
        await page.click('form button');
        await settle(page, '#/game/home');

        // Make the anthro to play (the home page's form), if it's there.
        if (await page.$('input[name="name"]')) {
            await page.fill('input[name="name"]', 'Ember');
            const species = await page.$('select[name="species_id"]');
            if (species) await species.selectOption({ index: 1 });
            const birthdate = await page.$('input[name="birthdate"]');
            if (birthdate && !(await birthdate.inputValue())) await birthdate.fill(new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10));
            await page.click('form[action*="/game/home"] button[type="submit"], form[action*="/game/home"] button:not([type])');
            await settle(page);
        }
        const heading = await page.textContent('h1');
        console.log('home:', heading?.trim());

        // Every page in the menus, and every admin page.
        const links = await page.$$eval('#main-nav a[href^="#/"], #admin-panel a[href^="#/"]', (as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
        for (const href of links) {
            await page.goto('file://' + file + href);
            await settle(page, href);
            const title = await page.title();
            console.log(`${href.padEnd(32)} ${title}`);
        }

        // Reload: the game is still there (kept in IndexedDB).
        await page.waitForTimeout(800);
        await context.close();
        context = await chromium.launchPersistentContext(profile, { headless: true });
        page = await open(context);
        await page.goto('file://' + file + '#/game/home');
        await settle(page, '#/game/home');
        const after = await page.textContent('h1');
        if (after?.trim() !== heading?.trim()) problems.push(`after reloading, the home page says "${after?.trim()}", not "${heading?.trim()}"`);
        else console.log('reloaded: the game was kept');
    } finally {
        await context.close();
        fs.rmSync(profile, { recursive: true, force: true });
    }
    if (problems.length) {
        console.error('\nProblems:\n- ' + problems.join('\n- '));
        process.exit(1);
    }
    console.log('\nOK');
}

async function open(context) {
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (e) => problems.push(`page error at ${page.url()}: ${e.message}`));
    page.on('console', (m) => {
        if (m.type() === 'error') problems.push(`console error at ${page.url()}: ${m.text()}`);
    });
    return page;
}

/** Waits for the page to be shown (and, if given, the address to be it), then checks for an error box. */
async function settle(page, hash) {
    if (hash) await page.waitForFunction((h) => location.hash === h || location.hash.startsWith(h + '?'), hash, { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => !document.documentElement.classList.contains('frontier-busy') && !document.getElementById('frontier-boot'), null, { timeout: 15000 });
    const error = await page.$('.alert-danger.position-fixed');
    if (error) problems.push(`error box at ${page.url()}: ${(await error.textContent()).trim()}`);
    const notPorted = await page.evaluate(() => document.body.innerText.match(/not ported yet[^\n]*/)?.[0]);
    if (notPorted) problems.push(`${page.url()}: ${notPorted}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
