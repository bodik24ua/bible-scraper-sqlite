const scrapeIt = require("scrape-it");
const fs = require('fs');
const path = require('path');
const VERSIONS_URL = "https://www.bible.com/versions";
const LANGUAGE_URL_BASE = "https://www.bible.com/languages/";
async function fetchAllTranslations() {
    console.log(`Завантаження першої сторінки для отримання загальної кількості...`);

    try {
        // 1. Завантажуємо першу сторінку, щоб дізнатися загальну кількість сторінок
        const { data: firstPageScrape } = await scrapeIt(`${VERSIONS_URL}?page=1`, {
            // Витягуємо весь JSON-об'єкт з даними сторінки
            pageData: {
                selector: "script#__NEXT_DATA__",
                how: "html",
                convert: x => JSON.parse(x)
            }
        });

        const firstVersionsData = firstPageScrape?.pageData?.props?.pageProps?.versionsData;
        const totalPages = firstVersionsData?.totalPages;

        if (!totalPages) {
            console.log("Не вдалося визначити загальну кількість сторінок. Можливо, структура сайту змінилася.");
            return;
        }

        console.log(`Знайдено ${totalPages} сторінок. Починаємо завантаження...`);

        let allLocales = [];

        // 2. Ітеруємо по всіх сторінках
        for (let page = 1; page <= totalPages; page++) {
            process.stdout.write(`  Завантаження сторінки ${page}/${totalPages}...\r`);

            const { data: pageScrape } = await scrapeIt(`${VERSIONS_URL}?page=${page}`, {
                pageData: {
                    selector: "script#__NEXT_DATA__",
                    how: "html",
                    convert: x => JSON.parse(x)
                }
            });

            const versionsData = pageScrape?.pageData?.props?.pageProps?.versionsData;

            if (versionsData && (versionsData.currentLocale || versionsData.otherLocales)) {
                // На першій сторінці є `currentLocale`, на інших — ні.
                if (versionsData.currentLocale) {
                    allLocales.push(versionsData.currentLocale);
                }
                if (versionsData.otherLocales) {
                    allLocales.push(...versionsData.otherLocales);
                }
            }
        }

        console.log(`\n\n[✓] Знайдено ${allLocales.length} мов з перекладами.\n`);

        // 3. Сортуємо та групуємо для виводу
        allLocales.sort((a, b) => (a.language.name || "").localeCompare(b.language.name || ""));

        let groupedByLang = {};
        for (let i = 0; i < allLocales.length; i++) {
            const locale = allLocales[i];
            const langInfo = locale.language;
            let englishName = langInfo.name;

            // Якщо англійська назва відсутня, робимо додатковий запит
            if (!englishName && langInfo.language_tag) {
                process.stdout.write(`  Уточнення назви для мови ${langInfo.language_tag}...\r`);
                try {
                    const { data: langPageScrape } = await scrapeIt(`${LANGUAGE_URL_BASE}${langInfo.language_tag}`, {
                        // Беремо назву з заголовка H1 для кращого форматування
                        h1_name: {
                            selector: "h1",
                            how: "text"
                        }
                    });
                    if (langPageScrape?.h1_name) {
                        englishName = langPageScrape.h1_name.replace('The Bible in ', '').trim();
                    }
                } catch (error) {
                    console.warn(`\n[!] Не вдалося отримати назву для ${langInfo.language_tag}`);
                }
            }
            englishName = englishName || 'Unknown';
            const localName = langInfo.local_name || 'Unknown';
            const langTag = langInfo.language_tag || 'unknown';

            // Створюємо більш описовий ключ
            let key;
            if (englishName.includes(localName)) {
                key = `${englishName} - ${langTag}`;
            } else {
                key = `${englishName} (${localName}) - ${langTag}`;
            }

            if (!groupedByLang[key]) {
                groupedByLang[key] = [];
            }

            // Add a check to ensure locale.versions is not undefined
            if (locale.versions && Array.isArray(locale.versions)) {
                locale.versions.forEach(v => {
                    groupedByLang[key].push({
                        id: v.id,
                        abbr: v.local_abbreviation,
                        name: v.local_title,
                        publisher: v.publisher_name
                    });
                });
            }
        }

        console.log('\nУточнення назв завершено.');

        // Зберігаємо результат у JSON-файл
        const outputPath = path.join(__dirname, 'translations.json');
        fs.writeFileSync(outputPath, JSON.stringify(groupedByLang, null, 2));
        console.log(`\n[✓] Список перекладів збережено у файл: ${outputPath}\n`);

        // 4. Виводимо результат
        for (const lang in groupedByLang) {
            console.log(`--- ${lang} ---`);
            groupedByLang[lang].forEach(t => {
                console.log(`  ID: ${t.id.toString().padEnd(5)} | ${t.abbr.padEnd(12)} | ${t.name} (${t.publisher})`);
            });
            console.log(''); // Порожній рядок для розділення
        }

    } catch (error) {
        console.error("\nСталася помилка під час завантаження:", error);
    }
}

fetchAllTranslations();
