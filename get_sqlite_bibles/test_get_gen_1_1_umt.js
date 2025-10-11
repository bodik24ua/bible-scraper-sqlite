const BibleScraper = require("bible-scraper");

// --- НАЛАШТУВАННЯ ---
const TRANSLATION_ID = 204; // Український переклад (Огієнко)
const VERSE_REFERENCE = "GEN.1.1"; // Буття 1:1
// --------------------

// Створюємо екземпляр скрейпера для українського перекладу
const UABible = new BibleScraper(TRANSLATION_ID);

async function getVerse() {
    try {
        console.log(`Завантаження вірша: ${VERSE_REFERENCE}...`);
        
        // Використовуємо метод .verse() для отримання одного вірша
        const verseData = await UABible.verse(VERSE_REFERENCE);
        
        if (verseData && verseData.content) {
            console.log("\n--- Буття 1:1 ---");
            console.log(verseData.content);
            console.log(`(${verseData.reference})`);
            console.log("-----------------");
        } else {
            console.log("Не вдалося отримати вірш. Можливо, посилання неправильне або виникла проблема з мережею.");
        }

    } catch (error) {
        console.error("Сталася помилка під час завантаження вірша:", error);
    }
}

/**
 * Виводить список доступних перекладів.
 */
function listAvailableTranslations() {
    console.log("\n--- Доступні переклади (мови) ---");
    const translations = BibleScraper.TRANSLATIONS;
    const translationCount = Object.keys(translations).length;
 
    console.log(`Повний список доступних перекладів (${translationCount}):`);
    Object.keys(translations).forEach(langCode => {
        console.log(`  - ${langCode}: ID ${translations[langCode]}`);
    });
 
    console.log("------------------------------------");
}

// Запускаємо функцію
listAvailableTranslations();
getVerse();
