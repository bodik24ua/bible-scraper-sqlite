// * Downloads each Bible translations into individual SQLite databases
// * Scraping from https://www.bible.com/ resource using bible-scraper
// * Displays real-time stats, progress bars, and logs
// * Supports configurable concurrency and language filtering
// * Logs errors to a file and continues processing other translations
// * Saves each translation in a separate SQLite database with verses and book names
// * Requires Node.js, blessed, blessed-contrib, sqlite3, and bible-scraper

// --- Configuration ---

/* ---- Change these settings as needed
   DEFAULT_CONCURRENCY: Number of concurrent downloads (workers) (1-100) Recommended not to exceed 20-30
   DOWNLOAD_ONLY_MAIN_LANGUAGES: Set to true to download only main languages or false for all languages in translations.json
   MAIN_LANGUAGE_CODES: List of main language codes to filter by if above is true */

// --- Download Settings ---
const DEFAULT_CONCURRENCY = 15; // Default number of workers
const DOWNLOAD_ONLY_MAIN_LANGUAGES = true; // Set to false to download all languages in translations.json
const MAIN_LANGUAGE_CODES = [
    'eng', 'spa', 'cmn', 'hin', 'arb', 'fra', 'ben', 'rus', 'por', 'urd', 'ind', 'deu', 'ita', 'nld', 'pol', 'ukr', 'tur', 'swe', 'nor', 'dan', 'fin', 'ell', 'bul', 'ces', 'slk', 'hun', 'ron', 'srp', 'hrv', 'bos', 'slv', 'mkd', 'sqi', 'lit', 'lav', 'est', 'ice', 'gle', 'mlt', 'cat', 'eus', 'cym', 'afr', 'jpn', 'kor', 'vie', 'fil', 'swh', 'plt', 'tha', 'mya', 'pes', 'tgl', 'san', 'lzh', 'grc', 'rmy', 'sna', 'ctu', 'cak', 'mam', 'spa_es', 'gle_gl', 'nob', 'lug', 'pan', 'tam', 'zho', 'zho_tw', 'glv', 'gla', 'lvs', 'bel', 'ekk', 'por_pt', 'tel', 'mar'
];

const blessed = require('blessed');
const contrib = require('blessed-contrib');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const BibleScraper = require("bible-scraper");

// --- Constants ---
const ALL_TRANSLATIONS_FILE = path.join(__dirname, 'translations.json');
const BIBLES_DIR = path.join(__dirname, 'bibles');
const ERROR_LOG_FILE = path.join(__dirname, 'error_log.txt');
const LOG_FILE = path.join(__dirname, 'run_log.txt');


// --- DB Helpers ---
function openDb(filepath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(filepath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) reject(err);
            else resolve(db);
        });
    });
}

function runQuery(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function closeDb(db) {
    return new Promise((resolve, reject) => {
        db.close((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// --- Logging ---
function logErrorToFile(error, context = 'General Error') {
    const timestamp = new Date().toISOString();
    const errorMessage = `${timestamp} [${context}]: ${error.stack || error}\n\n`;
    fs.appendFileSync(ERROR_LOG_FILE, errorMessage, 'utf-8');
}

// --- UI Setup with blessed-contrib ---
const screen = blessed.screen({
    smartCSR: true,
    title: 'Bible Downloader',
    fullUnicode: true,
    mouse: true // Enable mouse events for the whole screen
});

const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });

// Header
const header = grid.set(0, 0, 1, 12, blessed.text, {
    content: '📖 Bible Downloader from bible.com 📖  |  💻 👨‍💻 github.com/bodik24ua',
    tags: true,
    style: { fg: 'white', bold: true }
});

// Settings Box
const settingsBox = grid.set(1, 0, 1, 12, blessed.form, {
    label: ' {bold}Settings & Stats{/bold} ',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' } }
});

// Stats Boxes
// We use simple `blessed.box` instead of `contrib.lcd` to avoid rendering issues on small terminals
const stats = {
    workers: blessed.text({ parent: settingsBox, left: 1, top: 0, tags: true, content: '{bold}Workers:{/bold} ' }),
    languages: blessed.text({ parent: settingsBox, left: 22, top: 0, tags: true, content: '{bold}Languages:{/bold} 0' }),
    total: blessed.text({ parent: settingsBox, left: 42, top: 0, tags: true, content: '{bold}Total:{/bold} 0' }),
    completed: blessed.text({ parent: settingsBox, left: 62, top: 0, tags: true, content: '{bold}Completed:{/bold} {green-fg}0{/green-fg}' }),
    errors: blessed.text({ parent: settingsBox, left: 85, top: 0, tags: true, content: '{bold}Errors:{/bold} {red-fg}0{/red-fg}' })
};

// Helper functions to update the new stats boxes
stats.completed.setDisplay = function(text) {
    this.setContent(`{bold}Completed:{/bold} {green-fg}${text}{/green-fg}`);
};
stats.errors.setDisplay = function(text) {
    this.setContent(`{bold}Errors:{/bold} {red-fg}${text}{/red-fg}`);
};
stats.languages.setDisplay = function(text) {
    this.setContent(`{bold}Languages:{/bold} ${text}`);
}

const threadInput = blessed.textbox({
    parent: settingsBox, name: 'concurrency', inputOnFocus: true,
    height: 1, width: 5, top: 0, left: 11, value: String(DEFAULT_CONCURRENCY), style: { bg: 'blue' }
});

const startButton = blessed.button({
    parent: settingsBox, name: 'start', content: '▶ Start',
    width: 10, height: 1, right: 1, top: 0, shrink: true,
    mouse: true, // Enable mouse interaction for this button
    style: { bg: 'green', focus: { bg: 'red' }, hover: { bg: 'red' } }
});
// Log Box
const logBox = grid.set(2, 6, 9, 6, blessed.log, {
    label: ' {bold}Log{/bold} ',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', inverse: true },
    keys: true,
    mouse: false, // Set to false to prevent right-click crash. Manual scrolling implemented below.
    vi: true,
    tags: true, 
    style: { border: { fg: 'green' } }
});

// Progress Table
const progressTable = grid.set(2, 0, 9, 6, contrib.table, {
    keys: true,
    vi: true,
    mouse: false, // Disable mouse to avoid scroll conflicts
    label: ' {bold}Active Workers{/bold} ',
    border: { type: 'line' },
    tags: true,
    columnSpacing: 3,
    columnWidth: [3, 18, 25], // Worker #, Version, Status
    style: { border: { fg: 'yellow' }, header: { bold: true }, scrollbar: { bg: 'yellow' } },
    scrollable: true,
    scrollbar: { ch: ' ', inverse: true }
});

// Overall Progress Bar
const overallProgress = grid.set(11, 0, 1, 12, contrib.gauge, {
    label: 'Overall Progress',
    stroke: 'green',
    fill: 'white'
});

// --- App Logic ---

function log(message) {
    const timestamp = new Date().toLocaleTimeString();
    const uiMessage = `{grey-fg}[${timestamp}]{/grey-fg} ${message}`;
    logBox.log(uiMessage);

    // Write to file, stripping blessed formatting tags
    const fileMessage = `[${timestamp}] ${blessed.stripTags(message)}\n`; // Write to file, stripping blessed formatting tags
    fs.appendFileSync(LOG_FILE, fileMessage, 'utf-8');

    screen.render();
}

async function createTables(db) {
    await runQuery(db, `CREATE TABLE IF NOT EXISTS verses (book_number INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, text TEXT NOT NULL)`);
    await runQuery(db, `CREATE TABLE IF NOT EXISTS book_names (book_number INTEGER PRIMARY KEY, long_name TEXT NOT NULL, short_name TEXT NOT NULL)`);
    await runQuery(db, `DELETE FROM verses`);
    await runQuery(db, `DELETE FROM book_names`);
}

async function populateBookNames(db, bibleScraperInstance) {
    const bookNames = BibleScraper.BOOKS;
    const booksAndUsfmShortcodes = require('./lib/booksAndUsfmShortcodes');
    await runQuery(db, "BEGIN TRANSACTION");
    for (const bookIndex in bookNames) {
        const bookNumber = parseInt(bookIndex) + 1;
        const long_name = bookNames[bookIndex];
        const short_name = booksAndUsfmShortcodes[long_name];
        if (short_name) {
            await runQuery(db, "INSERT INTO book_names (book_number, long_name, short_name) VALUES (?, ?, ?)", [bookNumber, long_name, short_name]);
        }
    }
    await runQuery(db, "COMMIT");
}

async function populateAllVersesForTranslation(db, bibleScraperInstance, workerId, updateWorkerStatus) {
    const booksAndUsfmShortcodes = require('./lib/booksAndUsfmShortcodes');
    const bookList = BibleScraper.BOOKS;

    await runQuery(db, "BEGIN TRANSACTION");
    for (const bookIndex in bookList) {
        const bookNumber = parseInt(bookIndex) + 1;
        const long_name = bookList[bookIndex];
        const short_name = booksAndUsfmShortcodes[long_name];
        updateWorkerStatus(workerId, `📖 ${long_name} (${Math.round((bookNumber / bookList.length) * 100)}%)`);

        if (!short_name) continue;

        for (let chapterNum = 1; chapterNum < 200; chapterNum++) {
            try {
                const chapterData = await bibleScraperInstance.chapter(`${short_name}.${chapterNum}`);
                if (!chapterData || !chapterData.verses || chapterData.verses.length === 0) break;
                for (const verse of chapterData.verses) {
                    const verseNumber = parseInt(verse.reference.split(':').pop());
                    await runQuery(db, "INSERT INTO verses (book_number, chapter, verse, text) VALUES (?, ?, ?, ?)", [bookNumber, chapterNum, verseNumber, verse.content]);
                }
            } catch (error) {
                break;
            }
        }
    }
    await runQuery(db, "COMMIT");
}

let completedCount = 0;
let errorCount = 0;

async function runWithConcurrency(concurrency, tasks, totalTasks, startTime) {
    const limit = (await import('p-limit')).default(concurrency);
    const promises = [];

    for (const task of tasks) {
        promises.push(limit(async () => {
            await task();
            completedCount++;
            stats.completed.setDisplay(completedCount);

            const elapsed = (Date.now() - startTime) / 1000; // seconds
            const rate = completedCount / elapsed; // tasks/sec
            const remaining = totalTasks - completedCount;
            const eta = Math.round(remaining / rate);

            const percent = Math.round((completedCount / totalTasks) * 100);
            overallProgress.setPercent(percent);
            overallProgress.setLabel(`Overall Progress | ${completedCount}/${totalTasks} | ETA: ${isFinite(eta) && eta > 0 ? new Date(eta * 1000).toISOString().substr(11, 8) : '...'} `);
            screen.render();
        }));
    }
    await Promise.all(promises);
}

let workerStatuses = [];

function updateWorkerStatus(workerId, status) {
    if (workerStatuses[workerId]) {
        workerStatuses[workerId][2] = status;
        progressTable.setData({
            headers: ['#', 'Version', 'Status'],
            data: workerStatuses.slice(0, parseInt(threadInput.getValue(), 10))
        });
    }
    screen.render();
}

const processVersion = async (langKey, version) => { // version: { id, abbr, name }
    const langDirName = langKey.replace(/[\/\\?%*:|"<>]/g, "-");
    const langDirPath = path.join(BIBLES_DIR, langDirName);

    // Find an idle worker slot
    const workerId = workerStatuses.findIndex(s => !s || s[2].includes('Idle') || s[2].includes('Done') || s[2].includes('Error'));
    if (workerId === -1) {
        // This should not happen if concurrency logic is correct, but as a safeguard:
        log(`{orange-fg}No available worker slot for ${version.abbr}. This may be a bug.{/orange-fg}`);
        return; // Or queue it up
    }

    workerStatuses[workerId] = [workerId + 1, `${langKey.split(' - ')[0]} (${version.abbr})`, 'Waiting...'];
    if (!fs.existsSync(langDirPath)) {
        try { fs.mkdirSync(langDirPath, { recursive: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }

    const dbFilePath = path.join(langDirPath, `${version.abbr}_bible_id_${version.id}.sqlite`);
    let db;

    try {
        updateWorkerStatus(workerId, 'Waiting...');
        updateWorkerStatus(workerId, 'Starting...');
        log(`[W${workerId + 1}] Starting: ${version.abbr} (${langKey})`);
        db = await openDb(dbFilePath);
        await createTables(db);
        const bibleScraper = new BibleScraper(version.id);
        await populateBookNames(db, bibleScraper);
        await populateAllVersesForTranslation(db, bibleScraper, workerId, updateWorkerStatus);
        updateWorkerStatus(workerId, '{green-fg}✅ Done{/green-fg}');
        log(`{green-fg}[W${workerId + 1}] Finished: ${version.abbr} (${langKey}){/green-fg}`);
    } catch (error) {
        errorCount++;
        stats.errors.setDisplay(errorCount);
        const errorContext = `Version ${version.id} (${langKey})`; // Keep for logging
        log(`{red-fg}[W${workerId + 1}] Error with ${version.abbr}. Details in error_log.txt{/red-fg}`);
        logErrorToFile(error, errorContext);
        updateWorkerStatus(workerId, '{red-fg}❌ Error{/red-fg}');
    } finally {
        if (db) await closeDb(db);
        screen.render();
    }
};

startButton.on('press', async () => {
    const concurrency = parseInt(threadInput.getValue(), 10);
    if (isNaN(concurrency) || concurrency < 1 || concurrency > 100) {
        log('{red-fg}Error: Please enter a number between 1 and 100.{/red-fg}');
        return;
    }
    startButton.hide();
    threadInput.hide();
    stats.workers.setContent(`{bold}Workers:{/bold} ${concurrency}`);
    screen.render();
    await runDownloader(concurrency);
});

threadInput.on('submit', () => {
    startButton.press();
});

async function runDownloader(concurrency) {
    if (!fs.existsSync(ALL_TRANSLATIONS_FILE)) {
        log(`{red-fg}Error: File ${ALL_TRANSLATIONS_FILE} not found. Please run get_all_translations.js first{/red-fg}`);
        return;
    }
    if (!fs.existsSync(BIBLES_DIR)) fs.mkdirSync(BIBLES_DIR);

    // Clear the log file on each run
    const logHeader = `Bible Downloader Log - ${new Date().toISOString()}\n\n`;
    fs.writeFileSync(LOG_FILE, logHeader, 'utf-8');

    const allTranslations = JSON.parse(fs.readFileSync(ALL_TRANSLATIONS_FILE, "utf-8"));
    let languages = Object.entries(allTranslations);

    if (DOWNLOAD_ONLY_MAIN_LANGUAGES) {
        log('{yellow-fg}Download mode: Main (Major) languages only.{/yellow-fg}');
        const originalLangCount = languages.length;
        languages = languages.filter(([langKey]) => {
            const langCode = langKey.split(' - ').pop();
            return MAIN_LANGUAGE_CODES.includes(langCode);
        });
        const langNames = languages.map(([langKey]) => langKey.split(' - ')[0]);
        log(`{cyan-fg}Filtered from ${originalLangCount} to ${languages.length} languages. Will download: ${langNames.join(', ')}{/cyan-fg}`);
    } else {
        log('{yellow-fg}Download mode: All available languages in translations.json{/yellow-fg}');
        // write all language names to log
        const langNames = languages.map(([langKey]) => langKey.split(' - ')[0]);
        log(`{cyan-fg}Will download all ${languages.length} languages: ${langNames.join(', ')}{/cyan-fg}`);
    }

    const totalVersions = languages.reduce((sum, [, versions]) => sum + versions.length, 0);

    stats.total.setDisplay(totalVersions);
    stats.languages.setDisplay(languages.length);
    log(`Found ${languages.length} languages and ${totalVersions} versions to download.`);

    overallProgress.setLabel(`Overall Progress (0/${totalVersions}) | Elapsed: 00h 00m 00s | ETA: ...`);

    // Initialize worker statuses
    workerStatuses = Array.from({ length: concurrency }, (_, i) => [i + 1, '-', '{grey-fg}Idle{/grey-fg}']);
    progressTable.setData({
        headers: ['#', 'Version', 'Status'],
        data: workerStatuses
    });

    const tasks = [];
    languages.forEach(([langKey, versions]) => { // langKey = "English - eng"
        versions.forEach(version => { // version = { id, abbr, name, publisher }
            tasks.push(() => processVersion(langKey, version));
        });
    });

    log(`{yellow-fg}Starting processing with ${concurrency} worker(s)...{/yellow-fg}`);
    const startTime = Date.now();
    await runWithConcurrency(concurrency, tasks, totalVersions, startTime);

    log('{green-fg}✅ All translations processed successfully! Press ESC, q, or Ctrl+C to exit.{/green-fg}');
}

// --- Custom Mouse Scroll Handling ---
// This is a workaround for a bug in blessed where right-clicking a scrollable
// element with `mouse: true` causes a "Maximum call stack size exceeded" crash.
// We listen for wheel events on the screen and manually scroll the correct element.
screen.on('mouse', (data) => {
    if (data.action !== 'wheelup' && data.action !== 'wheeldown') {
        return;
    }

    const isOverElement = (el) => {
        return data.x >= el.aleft && data.x < el.aleft + el.width &&
               data.y >= el.atop && data.y < el.atop + el.height;
    };

    const target = isOverElement(logBox) ? logBox :
                   isOverElement(progressTable) ? progressTable : null;

    if (!target) return;

    data.action === 'wheelup' ? target.scroll(-1) : target.scroll(1);
});

screen.key(['escape', 'q', 'C-c'], () => process.exit(0));

threadInput.focus();
screen.render();