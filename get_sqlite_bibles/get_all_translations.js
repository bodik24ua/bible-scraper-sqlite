const scrapeIt = require("scrape-it");
const fs = require('fs');
const path = require('path');
const VERSIONS_URL = "https://www.bible.com/versions";
const LANGUAGE_URL_BASE = "https://www.bible.com/languages/";
async function fetchAllTranslations() {
    console.log(`Downloading the first page to get the total count...`);

    try {
        // 1. Download the first page to find out the total number of pages
        const { data: firstPageScrape } = await scrapeIt(`${VERSIONS_URL}?page=1`, {
            // Extract the entire JSON object with page data
            pageData: {
                selector: "script#__NEXT_DATA__",
                how: "html",
                convert: x => JSON.parse(x)
            }
        });

        const firstVersionsData = firstPageScrape?.pageData?.props?.pageProps?.versionsData;
        const totalPages = firstVersionsData?.totalPages;

        if (!totalPages) {
            console.log("Failed to determine the total number of pages. The site structure may have changed.");
            return;
        }

        console.log(`Found ${totalPages} pages. Starting download...`);

        let allLocales = [];

        // 2. Iterate through all pages
        for (let page = 1; page <= totalPages; page++) {
            process.stdout.write(`  Downloading page ${page}/${totalPages}...\r`);

            const { data: pageScrape } = await scrapeIt(`${VERSIONS_URL}?page=${page}`, {
                pageData: {
                    selector: "script#__NEXT_DATA__",
                    how: "html",
                    convert: x => JSON.parse(x)
                }
            });

            const versionsData = pageScrape?.pageData?.props?.pageProps?.versionsData;

            if (versionsData && (versionsData.currentLocale || versionsData.otherLocales)) {
                // The first page has `currentLocale`, others do not.
                if (versionsData.currentLocale) {
                    allLocales.push(versionsData.currentLocale);
                }
                if (versionsData.otherLocales) {
                    allLocales.push(...versionsData.otherLocales);
                }
            }
        }

        console.log(`\n\n[✓] Found ${allLocales.length} languages with translations.\n`);

        // 3. Sort and group for output
        allLocales.sort((a, b) => (a.language.name || "").localeCompare(b.language.name || ""));

        let groupedByLang = {};
        for (let i = 0; i < allLocales.length; i++) {
            const locale = allLocales[i];
            const langInfo = locale.language;
            let englishName = langInfo.name;

            // If the English name is missing, make an additional request
            if (!englishName && langInfo.language_tag) {
                process.stdout.write(`  Clarifying name for language ${langInfo.language_tag}...\r`);
                try {
                    const { data: langPageScrape } = await scrapeIt(`${LANGUAGE_URL_BASE}${langInfo.language_tag}`, {
                        // Take the name from the H1 header for better formatting
                        h1_name: {
                            selector: "h1",
                            how: "text"
                        }
                    });
                    if (langPageScrape?.h1_name) {
                        englishName = langPageScrape.h1_name.replace('The Bible in ', '').trim();
                    }
                } catch (error) {
                    console.warn(`\n[!] Could not get name for ${langInfo.language_tag}`);
                }
            }
            englishName = englishName || 'Unknown';
            const localName = langInfo.local_name || 'Unknown';
            const langTag = langInfo.language_tag || 'unknown';

            // Create a more descriptive key
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

        console.log('\nFinished clarifying names.');

        // Save the result to a JSON file
        const outputPath = path.join(__dirname, 'translations.json');
        fs.writeFileSync(outputPath, JSON.stringify(groupedByLang, null, 2));
        console.log(`\n[✓] List of translations saved to file: ${outputPath}\n`);

        // 4. Output the result
        /*
        for (const lang in groupedByLang) {
            console.log(`--- ${lang} ---`);
            groupedByLang[lang].forEach(t => {
                console.log(`  ID: ${t.id.toString().padEnd(5)} | ${t.abbr.padEnd(12)} | ${t.name} (${t.publisher})`);
            });
            console.log(''); 
        }
        */

    } catch (error) {
        console.error("\nAn error occurred during download, try again:", error);
    }
}

fetchAllTranslations();
