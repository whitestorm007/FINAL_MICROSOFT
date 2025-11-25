const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const { URLSearchParams } = require("url");
const crypto = require("crypto");
const { HeaderGenerator } = require("header-generator");
const RewardsGrind = require("./Rewardsgrind");

// --- User Agent constants to simulate different devices ---
const USER_AGENTS = {
    PC: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    MOBILE:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0.2 Mobile/15E148 Safari/604.1",
};

// class BingSearch {
//     /**
//      * @param {object} task - The task object from the daily plan.
//      * @param {string} email - The email of the account being processed.
//      * @param {string} cookieJar - The serialized cookie jar string from the database.
//      */
//     constructor(task, email, cookieJar) {
//         this.task = task;
//         this.email = email;
//         this.cvid = crypto.randomUUID().replace(/-/g, '').toUpperCase();

//         // --- Robust Cookie Deserialization ---
//         if (cookieJar) {
//             try {
//                 // Parse the string from the database.
//                 let parsedData = JSON.parse(cookieJar);

//                 // ** THIS IS THE FIX **
//                 // Check for the malformed structure: an object with a single "cookies" key
//                 // that contains the actual cookie jar object.
//                 if (parsedData.cookies && parsedData.cookies.storeType === 'MemoryCookieStore') {
//                     console.log(`[BingSearch] Detected and correcting malformed cookie jar for ${email}.`);
//                     // Unwrap the object to get the correct structure.
//                     parsedData = parsedData.cookies;
//                 }

//                 // Re-create the cookie jar from the corrected object.
//                 this.cookieJar = CookieJar.deserializeSync(parsedData);

//             } catch (e) {
//                 console.error(`[BingSearch] Error deserializing cookie jar for ${email}. Starting fresh.`, e);
//                 this.cookieJar = new CookieJar();
//             }
//         } else {
//             this.cookieJar = new CookieJar();
//         }

//         this.axiosInstance = wrapper(axios.create({ jar: this.cookieJar }));

//     }

//     /**
//      * Simulates a human typing delay.
//      * @private
//      */
//     _humanTypingDelay() {
//         // Wait for a random time between 70ms and 350ms
//         const delay = Math.random() * (350 - 70) + 70;
//         return new Promise(resolve => setTimeout(resolve, delay));
//     }

//     /**
//      * Simulates the network requests sent as a user types a query character by character.
//      * @private
//      */
//     async _simulateTyping() {
//         console.log(`[BingSearch] Simulating typing for query: "${this.task.query}"`);
//         const loadingChars = ['|', '/', '-', '\\'];
//         let charIndex = 0;

//         for (let i = 0; i < this.task.query.length; i++) {
//             const typedPart = this.task.query.substring(0, i + 1);
//             const params = new URLSearchParams({
//                 pt: 'page.home',
//                 pths: '1',
//                 qry: typedPart,
//                 cp: typedPart.length, // Cursor Position
//                 cvid: this.cvid
//             });

//             const url = `https://www.bing.com/AS/Suggestions?${params.toString()}`;

//             try {
//                 const loadingChar = loadingChars[charIndex++ % loadingChars.length];
//                 process.stdout.write(`  -> Typing: ${typedPart} ${loadingChar}\r`);

//                 await this.axiosInstance.get(url);
//             } catch (error) {
//                 process.stdout.write('\n'); // Move to next line on error
//                 console.warn(`[BingSearch] Suggestion request for '${typedPart}' failed. Continuing...`);
//             }

//             await this._humanTypingDelay();
//         }

//         process.stdout.write(' '.repeat(this.task.query.length + 15) + '\r');
//         console.log(`  -> Typing complete: "${this.task.query}"`);
//     }

//     /**
//      * Executes the final search request after typing is simulated.
//      * @private
//      */
//     async _executeFinalSearch() {
//         const params = new URLSearchParams({
//             q: this.task.query,
//             form: 'QBRE',
//             cvid: this.cvid
//         });
//         const url = `https://www.bing.com/search?${params.toString()}`;

//         console.log(`[BingSearch] Executing final search...`);
//         await this.axiosInstance.get(url);
//     }

//     /**
//      * Executes the search task.
//      * @returns {Promise<{success: boolean, message: string, updatedCookieJar: string}>}
//      */
//     async execute() {
//         console.log(`[BingSearch] Executing task for ${this.email}: Type: ${this.task.taskType}, Device: ${this.task.device}`);

//         if (this.task.taskType === 'SEARCH' && this.task.query) {
//             await this._simulateTyping();
//             await this._executeFinalSearch();
//         } else {
//             console.log(`[BingSearch] Task is not a search type or has no query. Skipping automation.`);
//         }

//         // Correctly serialize the jar for storage.
//         const updatedCookieJarString = JSON.stringify(this.cookieJar.toJSON());

//         return { success: true, message: "Search completed.", updatedCookieJar: updatedCookieJarString };
//     }
// }

class BingSearch {
    /**
     * @param {object} task - The task object from the daily plan.
     * @param {string} email - The email of the account being processed.
     * @param {string} cookieJarString - The serialized cookie jar string from the database.
     */
    constructor(task, email, cookieJarString) {
        this.task = task;
        this.email = email;
        this.cvid = crypto.randomUUID().replace(/-/g, "").toUpperCase();

        this.cookieJarString = cookieJarString;
        // --- Robust Cookie Deserialization (Inspired by your old code) ---
        this.cookieJar = this._importCookieJar(cookieJarString) || new CookieJar();

        // --- Dynamic Header Generation ---
        const headerGenerator = new HeaderGenerator({
            browsers: ["chrome"],
            operatingSystems: ["windows"],
            devices: ["desktop"],
            locales: ["en-US"],
        });
        const dynamicHeaders = headerGenerator.getHeaders();

        this.axiosInstance = wrapper(
            axios.create({
                jar: this.cookieJar,
                headers: dynamicHeaders,
            })
        );

        this.axiosInstance.interceptors.request.use(
            (request) => {
                // We only want to log the relevant headers, not the entire object.

                return request; // It's crucial to return the request config.
            },
            (error) => {
                console.error("[Request Interceptor Error]", error);
                return Promise.reject(error);
            }
        );
    }

    /**
     * Imports a cookie jar from a JSON string, handling both old and new formats.
     * @param {string} cookieJarString - The JSON string from the database.
     * @returns {CookieJar|null}
     * @private
     */
    _importCookieJar(cookieJarString) {
        if (!cookieJarString) return null;
        try {
            const data = JSON.parse(cookieJarString);
            let cookieData;

            // Handle new format (wrapped with metadata) and old format (raw cookie jar)
            if (data.cookies && data.metadata) {
                cookieData = data.cookies; // New, preferred format
            } else if (data.storeType === "MemoryCookieStore") {
                cookieData = data; // Old format (raw tough-cookie object)
            } else if (
                data.cookies &&
                data.cookies.storeType === "MemoryCookieStore"
            ) {
                console.log(
                    `[BingSearch] Detected and correcting malformed cookie jar for ${this.email}.`
                );
                cookieData = data.cookies; // Correcting a previously malformed structure
            } else {
                throw new Error("Serialized cookie jar is in an unknown format.");
            }

            console.log(CookieJar.deserializeSync(cookieData));
            return CookieJar.deserializeSync(cookieData);
        } catch (err) {
            console.error(
                `[BingSearch] Failed to parse cookie jar for ${this.email}. Starting fresh.`,
                err
            );
            return null;
        }
    }

    /**
     * Exports the current cookie jar to a JSON string with metadata.
     * @returns {string}
     * @private
     */
    _exportCookieJar() {
        const jarData = this.cookieJar.toJSON();
        return JSON.stringify({
            cookies: jarData,
            metadata: { lastExported: new Date().toISOString() },
        });
    }

    /**
     * Simulates a human typing delay.
     * @private
     */
    _humanTypingDelay() {
        const delay = Math.random() * (350 - 70) + 70;
        return new Promise((resolve) => setTimeout(resolve, delay));
    }

    /**
     * Simulates the network requests sent as a user types a query character by character.
     * @private
     */
    async _simulateTyping() {
        console.log(`[BingSearch] Simulating typing for query: "${this.task.query}"`);
        const loadingChars = ['|', '/', '-', '\\'];
        let charIndex = 0;

        // Get cookies from bing.com domain
        const bingCookies = await this.cookieJar.getCookies('https://bing.com');
        const cookieString = bingCookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');

        for (let i = 0; i < this.task.query.length; i++) {
            const typedPart = this.task.query.substring(0, i + 1);
            const params = new URLSearchParams({
                pt: 'page.home',
                pths: '1',
                qry: typedPart,
                cp: typedPart.length,
                cvid: this.cvid
            });

            const url = `https://www.bing.com/AS/Suggestions?${params.toString()}`;

            try {
                const loadingChar = loadingChars[charIndex++ % loadingChars.length];
                process.stdout.write(`  -> Typing: ${typedPart} ${loadingChar}\r`);

                await this.axiosInstance.get(url, {
                    headers: {
                        'accept': '*/*',
                        'accept-language': 'en-GB,en;q=0.9',
                        'cache-control': 'no-cache',
                        'dnt': '1',
                        'pragma': 'no-cache',
                        'priority': 'u=0, i',
                        'referer': 'https://www.bing.com/',
                        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
                        'sec-ch-ua-arch': '"arm"',
                        'sec-ch-ua-bitness': '"64"',
                        'sec-ch-ua-full-version': '"142.0.7444.135"',
                        'sec-ch-ua-full-version-list': '"Chromium";v="142.0.7444.135", "Google Chrome";v="142.0.7444.135", "Not_A Brand";v="99.0.0.0"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-model': '""',
                        'sec-ch-ua-platform': '"macOS"',
                        'sec-ch-ua-platform-version': '"15.6.0"',
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-mode': 'cors',
                        'sec-fetch-site': 'same-origin',
                        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
                        'Cookie': cookieString, // Use cookies from bing.com
                    }
                });
            } catch (error) {
                process.stdout.write('\n');
                console.warn(`[BingSearch] Suggestion request for '${typedPart}' failed. Continuing...`);
            }

            //  await this._humanTypingDelay();
        }

        process.stdout.write(' '.repeat(this.task.query.length + 15) + '\r');
        console.log(`  -> Typing complete: "${this.task.query}"`);
    }

    /**
     * Executes the final search request after typing is simulated.
     * @private
     */

    async _executeFinalSearch() {
        // Get cookies from bing.com domain
        const bingCookies = await this.cookieJar.getCookies("https://bing.com");
        const cookieString = bingCookies
            .map((cookie) => `${cookie.key}=${cookie.value}`)
            .join("; ");

        const params = new URLSearchParams({
            q: this.task.query,
            form: "QBRE",
            cvid: this.cvid,
        });
        const url = `https://www.bing.com/search?${params.toString()}`;

        console.log(`[BingSearch] Executing final search...`);

        try {
            await this.axiosInstance.get(url, {
                headers: {
                    accept:
                        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                    "accept-language": "en-GB,en;q=0.9",
                    "cache-control": "no-cache",
                    dnt: "1",
                    ect: "3g",
                    pragma: "no-cache",
                    priority: "u=0, i",
                    referer: "https://www.bing.com/search",
                    "sec-ch-ua":
                        '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
                    "sec-ch-ua-arch": '"arm"',
                    "sec-ch-ua-bitness": '"64"',
                    "sec-ch-ua-full-version": '"142.0.7444.135"',
                    "sec-ch-ua-full-version-list":
                        '"Chromium";v="142.0.7444.135", "Google Chrome";v="142.0.7444.135", "Not_A Brand";v="99.0.0.0"',
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-model": '""',
                    "sec-ch-ua-platform": '"macOS"',
                    "sec-ch-ua-platform-version": '"15.6.0"',
                    "sec-fetch-dest": "document",
                    "sec-fetch-mode": "navigate",
                    "sec-fetch-site": "same-origin",
                    "sec-fetch-user": "?1",
                    "upgrade-insecure-requests": "1",
                    "user-agent":
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
                    Cookie: cookieString, // Use cookies from bing.com
                },
            });
        } catch (error) {
            console.error(
                `[BingSearch] Error executing final search:`,
                error.message
            );
            throw error;
        }
    }
    // async _executeFinalSearch() {
    //     const params = new URLSearchParams({
    //         q: this.task.query,
    //         form: 'QBRE',
    //         cvid: this.cvid
    //     });
    //     const url = `https://www.bing.com/search?${params.toString()}`;

    //     console.log(`[BingSearch] Executing final search...`);
    //     await this.axiosInstance.get(url);
    // }

    /**
     * Executes the search task.
     * @returns {Promise<{success: boolean, message: string, updatedCookieJar: string}>}
     */
    async execute() {
        console.log(
            `[BingSearch] Executing task for ${this.email}: Type: ${this.task.taskType}, Device: ${this.task.device}`
        );

        if (this.task.taskType === "SEARCH" && this.task.query) {
            await this._simulateTyping();
            await this._executeFinalSearch();
        } else {
            var RG = new RewardsGrind(null, this.email, this.cookieJarString);
            await RG.execute();
            var report = RG.getReport();
            console.log({ report });
            console.log(
                `[BingSearch] Task is not a search type or has no query. Skipping automation.`
            );
        }

        const updatedCookieJarString = this._exportCookieJar();

        return {
            success: true,
            message: "Search completed.",
            updatedCookieJar: updatedCookieJarString,
        };
    }
}

module.exports = BingSearch;
// module.exports = BingSearch;
