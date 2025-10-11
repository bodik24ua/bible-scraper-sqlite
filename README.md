# 📖 Bible Scraper SQLite Tools 🛠️

> **Note**: This project is a fork of the original [bible-scraper by @IonicaBizau](https://github.com/IonicaBizau/bible-scraper), extended with tools to download and store Bible translations into individual SQLite databases.

This directory contains a set of Node.js scripts designed to scrape Bible translations from [bible.com](https://www.bible.com/) (YouVersion) and store them in individual SQLite databases. The main script provides a rich Terminal User Interface (TUI) for monitoring the download process in real-time.

## ✨ Features

*   📜 **Fetch All Translations**: Get an up-to-date list of all available translations with a single command.
*   🚀 **Concurrent Downloads**: Downloads multiple Bible versions simultaneously to dramatically speed up the process.
*   🖥️ **Rich Terminal UI**: The main script (`get_bibles_into_sqlite.js`) uses a `blessed`-based dashboard to show:
    *   Real-time stats (workers, total/completed versions, errors).
    *   A table of active workers and their current progress.
    *   A detailed log of events.
    *   An overall progress gauge with ETA.
*   ⚙️ **Configurable**: Easily configure concurrency and filter which languages to download by editing the script.
*   🛡️ **Robust Error Handling**: Errors are logged to `error_log.txt` without stopping the entire process, ensuring maximum completion.
*   🗃️ **Organized Output**: Each translation is saved in a separate SQLite file within a structured directory: `bibles/<Language>/<Version>.sqlite`.

---

## 📂 Scripts Overview

> #### 📜 `get_all_translations.js`
> This is the **first script you must run**. It scrapes bible.com for all available languages and translations and saves them into `translations.json`. This file is required by the download scripts.

> #### 🚀 `get_bibles_into_sqlite.js`
> This is the **main script** for downloading the Bibles. It provides a full-featured terminal dashboard to monitor the process. It is highly recommended for the best user experience.

> #### 💻 `get_bibles_cmd_v*_sqlite.js`
> These are alternative, simpler command-line downloaders without the terminal dashboard. They are useful for environments where the `blessed` library might not be supported or for users who prefer simple console output.
    *   `v1`: Uses a custom concurrency limiter and multiple progress bars.
    *   `v2`: Uses `p-limit` for concurrency and prompts the user for the number of workers.
    *   `v3`: A streamlined version using `p-limit` that logs progress directly to the console.

> #### 🧪 `test_get_gen_1_1_umt.js`
> A simple test script to verify that the underlying `bible-scraper` library can fetch a single verse. Useful for debugging connection or library issues.

## Prerequisites

1.  **Node.js**: Ensure you have a recent version of Node.js installed.
2.  **Dependencies**: You must install the required npm packages from the project's root directory.

    ```sh
    # Navigate to the root of the bible-scraper-sqlite project
    npm install
    ```
    
    This project relies on several key npm packages to function:
    *   `bible-scraper`: The core library for fetching Bible data from bible.com.
    *   `sqlite3`: The driver used to create and manage the `.sqlite` database files.
    *   `blessed` & `blessed-contrib`: For building the rich Terminal User Interface (TUI) in the main script.
    *   `cli-progress`: To display progress bars in the simpler command-line scripts.
    *   `p-limit`: For managing concurrency to prevent overwhelming the server with requests.
    *   `scrape-it`: Used by `get_all_translations.js` to find all available Bible versions.
    *   `inquirer`: To prompt for user input in the `v2` command-line script.


## 🚀 Getting Started

Follow these steps to download the Bible translations.

### Step 1: Fetch the Translation List

First, run `get_all_translations.js` to create the `translations.json` file. This file contains the metadata for all Bible versions that the downloader will use.

```sh
node get_sqlite_bibles/get_all_translations.js
```

This will take a few moments and will output the list of found translations to your console and save it to `get_sqlite_bibles/translations.json`.

### Step 2: Run the Downloader

Once you have the `translations.json` file, you can start the main downloader with its terminal UI.

```sh
node get_sqlite_bibles/get_bibles_into_sqlite.js
```

You will be presented with a dashboard where you can:
1.  **Set Concurrency**: Enter the number of concurrent downloads (workers) you want to use. A value between 15-30 is a good starting point.
2.  **Start**: Press the "Start" button (or hit Enter) to begin the download process.
3.  **Monitor**: Watch the progress in the "Active Workers" table, the "Log" panel, and the "Overall Progress" bar.
4.  **Exit**: Press `Esc`, `q`, or `Ctrl+C` to exit the application.

### Configuration

You can easily configure the download process by editing the constants at the top of the `get_bibles_into_sqlite.js` file:

*   `DEFAULT_CONCURRENCY`: Sets the default number of concurrent workers.
*   `DOWNLOAD_ONLY_MAIN_LANGUAGES`: Set to `true` to only download a curated list of major world languages. Set to `false` to attempt downloading all languages found in `translations.json`.
*   `MAIN_LANGUAGE_CODES`: If the above is `true`, this array contains the language codes (e.g., 'eng', 'spa', 'ukr') to be downloaded.

## Output

*   🗃️ **Databases**: The downloaded Bibles are stored in the `get_sqlite_bibles/bibles/` directory. The structure is `bibles/<Language-Name>/<VersionAbbr>_bible_id_<ID>.sqlite`.
*   📄 **Logs**:
    *   `run_log.txt`: A log of the main events during a run of `get_bibles_into_sqlite.js`.
    *   `error_log.txt`: A detailed log of any errors that occurred during the download process. Check this file if you see the error count increase in the UI.

### 🏛️ Database Schema

Each generated SQLite database (`.sqlite`) contains two tables with a clean and simple structure:

1.  **`book_names`**: Stores the mapping of book numbers to their names.
    *   `book_number` (INTEGER, PRIMARY KEY): The sequential number of the book (1-66).
    *   `long_name` (TEXT): The full name of the book (e.g., "Genesis").
    *   `short_name` (TEXT): The USFM abbreviation for the book (e.g., "GEN").

2.  **`verses`**: Stores the text of every verse.
    *   `book_number` (INTEGER): Foreign key referencing `book_names`.
    *   `chapter` (INTEGER): The chapter number.
    *   `verse` (INTEGER): The verse number.
    *   `text` (TEXT): The content of the verse.

---
