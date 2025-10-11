const BibleScraper = require("bible-scraper");
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cliProgress = require('cli-progress');
const inquirer = require('inquirer');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ALL_TRANSLATIONS_FILE = path.join(__dirname, 'translations.json');
const BIBLES_DIR = path.join(__dirname, 'bibles');
const ERROR_LOG_FILE = path.join(__dirname, 'error_log.txt');

// --- Обертки для роботи з sqlite3 через async/await ---

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

// --- Основні функції ---

/**
 * Записує помилку у файл логів.
 */
function logErrorToFile(error, context = 'General Error') { // Keep "General Error" as it's a good default
    const timestamp = new Date().toISOString();
    const errorMessage = `${timestamp} [${context}]: ${error.stack || error}\n\n`;
    fs.appendFileSync(ERROR_LOG_FILE, errorMessage, 'utf-8');
}

/**
 * Створює таблиці в базі даних.
 */
async function createTables(db) {
    await runQuery(db, `CREATE TABLE IF NOT EXISTS verses (
        book_number INTEGER NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        text TEXT NOT NULL
    )`);
    await runQuery(db, `CREATE TABLE IF NOT EXISTS book_names (
        book_number INTEGER PRIMARY KEY,
        long_name TEXT NOT NULL,
        short_name TEXT NOT NULL
    )`);
}

/**
 * Заповнює таблицю book_names.
 */
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

/**
 * Парсить і вставляє всі вірші для одного перекладу.
 */
async function populateAllVersesForTranslation(db, bibleScraperInstance, progressBar) {
    const booksAndUsfmShortcodes = require('./lib/booksAndUsfmShortcodes');
    const bookList = BibleScraper.BOOKS;

    // const progressBar = new cliProgress.SingleBar({
    //     format: '  Завантаження книг: [{bar}] {percentage}% | {value}/{total} | {bookName}'
    // }, cliProgress.Presets.shades_classic);
    // progressBar.start(bookList.length, 0, { bookName: "N/A" });

    await runQuery(db, "BEGIN TRANSACTION");
    for (const bookIndex in bookList) {
        const bookNumber = parseInt(bookIndex) + 1;
        const long_name = bookList[bookIndex];
        const short_name = booksAndUsfmShortcodes[long_name];

        if (!short_name) {
            console.warn(`\n[!] Skipped book "${long_name}" because its abbreviation was not found.`);
            continue;
        }

        for (let chapterNum = 1; chapterNum < 200; chapterNum++) { // 200 - безпечна верхня межа
            try {
                const chapterData = await bibleScraperInstance.chapter(`${short_name}.${chapterNum}`);
                if (!chapterData || !chapterData.verses || chapterData.verses.length === 0) {
                    break; // Кінець книги
                }

                for (const verse of chapterData.verses) {
                    const verseNumber = parseInt(verse.reference.split(':').pop());
                    await runQuery(db, "INSERT INTO verses (book_number, chapter, verse, text) VALUES (?, ?, ?, ?)", [bookNumber, chapterNum, verseNumber, verse.content]);
                }
            } catch (error) {
                break; // Помилка, ймовірно, означає кінець книги
            }
        }
    }
    await runQuery(db, "COMMIT");
}

/**
 * Функція для обробки однієї версії в окремому потоці.
 */
async function main() {
    if (!fs.existsSync(ALL_TRANSLATIONS_FILE)) {
        console.error(`Error: File ${ALL_TRANSLATIONS_FILE} not found. Please run get_all_translations.js first`);
        return;
    }

    if (!fs.existsSync(BIBLES_DIR)) {
        fs.mkdirSync(BIBLES_DIR);
    }

    const allTranslations = JSON.parse(fs.readFileSync(ALL_TRANSLATIONS_FILE, "utf-8"));
    const languages = Object.entries(allTranslations); // languages = [ [ 'eng', versions], ['ukr', versions] ]

    // Розраховуємо загальну кількість версій для завантаження
    const totalVersions = languages.reduce((sum, [, versions]) => sum + versions.length, 0);

    console.log(`Found ${languages.length} languages and ${totalVersions} versions to download.`);

    // --- Інтерактивне налаштування ---
    const { concurrency } = await inquirer.prompt([
        {
            type: 'number',
            name: 'concurrency',
            message: 'Enter the number of concurrent workers:',
            default: 15,
            validate: (input) => {
                if (input > 0 && input <= 100) {
                    return true;
                }
                return 'Please enter a number between 1 and 100.';
            }
        }
    ]);
    // Функція для обмеження кількості одночасних потоків
    async function runWithConcurrency(concurrency, tasks, mainProgressBar) {
        const limit = (await import('p-limit')).default(concurrency);
        const promises = [];

        for (const task of tasks) {
            // `limit` гарантує, що одночасно буде виконуватися не більше `concurrency` завдань.
            // Коли одне завдання завершується, `p-limit` автоматично запускає наступне з черги.
            promises.push(limit(async () => {
                // Ми більше не передаємо workerId, оскільки p-limit керує цим абстрактно.
                // Логування тепер буде без ID воркера, але процес буде надійним.
                await task();
                mainProgressBar.increment();
            }));
        }

        await Promise.all(promises);
    }

    // Створюємо головний прогрес-бар як окремий екземпляр
    const totalProgressBar = new cliProgress.SingleBar({
        format: 'Overall Progress |{bar}| {percentage}% || {value}/{total} versions || ETA: {eta_formatted}',
        // Важливо: не очищати, щоб він залишався видимим
        clearOnComplete: false,
        // Розміщуємо його в окремому рядку, щоб він не конфліктував з multibar
        forceRedraw: true,
        linewrap: true,
    }, cliProgress.Presets.shades_classic);

    // Функція для запуску обробки мови в окремому потоці
    const processVersion = async (langKey, version) => {
        const logPrefix = `[${version.abbr}]`;
        const langDirName = langKey.replace(/[\/\\?%*:|"<>]/g, "-");
        const langDirPath = path.join(BIBLES_DIR, langDirName);

        if (!fs.existsSync(langDirPath)) {
            try {
                fs.mkdirSync(langDirPath, { recursive: true });
            } catch (e) {
                if (e.code !== 'EEXIST') throw e;
            }
        }

        const dbFilePath = path.join(langDirPath, `${version.abbr}_bible_id_${version.id}.sqlite`);
        let db;

        try {
            db = await openDb(dbFilePath);
            await createTables(db);
            const bibleScraper = new BibleScraper(version.id);
            await populateBookNames(db, bibleScraper);
            console.log(`${logPrefix} Downloading ${version.abbr} (${langKey})...`);
            await populateAllVersesForTranslation(db, bibleScraper);
            console.log(`${logPrefix} ✅ Finished: ${version.abbr} (${langKey})`);
        } catch (error) {
            const errorContext = `Version ${version.id} (${langKey})`;
            console.error(`\n${logPrefix} [!] Error with version ${version.abbr} (${langKey}). Details in error_log.txt`);
            logErrorToFile(error, errorContext);
        } finally {
            if (db) await closeDb(db);
        }
    };

    // Створюємо "плоский" масив завдань для кожної ВЕРСІЇ
    const tasks = [];
    languages.forEach(([langKey, versions]) => {
        versions.forEach(version => {
            tasks.push(() => processVersion(langKey, version));
        });
    });

    // Запускаємо обробку з обмеженням у 15 одночасних потоків
    const CONCURRENCY_LIMIT = concurrency;
    console.log(`\nStarting processing with ${CONCURRENCY_LIMIT} worker(s)...`);

    totalProgressBar.start(totalVersions, 0);
    await runWithConcurrency(CONCURRENCY_LIMIT, tasks, totalProgressBar);

    totalProgressBar.stop();

    console.log("\n\n✅ All translations processed successfully!");
}


if (isMainThread) {
    main().catch(err => {
        console.error("Critical error in the main thread. Details in error_log.txt");
        logErrorToFile(err, 'Main Thread');
    });
} else {
    // Код, який виконується в потоці-працівнику
    (async () => {
        // parentPort.postMessage({ result: await processVersion(workerData) });
    })();
    }