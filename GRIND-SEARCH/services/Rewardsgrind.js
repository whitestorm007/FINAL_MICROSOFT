const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const crypto = require("crypto");
const { HeaderGenerator } = require("header-generator");
const cheerio = require("cheerio");
const fs = require("fs");

/**
 * RewardsGrind - Advanced Microsoft Rewards Task Automation
 * Handles all reward tasks except search-related activities
 */
class RewardsGrind {
    /**
     * @param {object} dashboardData - The complete dashboard data from rewards.json
     * @param {string} email - The email of the account being processed
     * @param {string} cookieJarString - The serialized cookie jar string from the database
     * @param {object} options - Additional configuration options
     */
    constructor(dashboardData, email, cookieJarString, options = {}) {
        this.dashboardData = dashboardData;
        this.email = email;
        this.options = {
            skipSearchTasks: true, // Always skip search tasks as per requirements
            delayBetweenTasks: 2000, // 2 seconds delay between tasks
            maxRetries: 3,
            timezone: 0, // Default IST timezone offset
            ...options,
        };
        // --- Robust Cookie Deserialization ---
        this.cookieJar = this._importCookieJar(cookieJarString) || new CookieJar();

        // --- Dynamic Header Generation ---
        const headerGenerator = new HeaderGenerator({
            browsers: ["chrome"],
            operatingSystems: ["windows", "macos"],
            devices: ["desktop"],
            locales: ["en-US", "en-GB"],
        });
        const dynamicHeaders = headerGenerator.getHeaders();

        // --- Axios Instance with Cookie Support ---
        this.axiosInstance = wrapper(
            axios.create({
                jar: this.cookieJar,
                headers: {
                    ...dynamicHeaders,
                    Accept: "application/json, text/javascript, */*; q=0.01",
                    "Accept-Language": "en-GB,en;q=0.9",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                },
                timeout: 30000,
            })
        );

        // Request interceptor for logging
        this.axiosInstance.interceptors.request.use(
            (request) => {
                console.log(`[${this.email}] Making request to: ${request.url}`);
                return request;
            },
            (error) => {
                console.error(
                    `[${this.email}] Request interceptor error:`,
                    error.message
                );
                return Promise.reject(error);
            }
        );

        // Response interceptor for error handling
        this.axiosInstance.interceptors.response.use(
            (response) => response,
            (error) => {
                console.error(`[${this.email}] Response error:`, error.message);
                return Promise.reject(error);
            }
        );

        // Task execution tracking
        this.executionLog = {
            completed: [],
            failed: [],
            skipped: [],
            totalPoints: 0,
        };
    }

    /**
     * Main execution method - processes all available tasks
     */
    async execute() {
        console.log(`\n[${this.email}] ========================================`);
        console.log(`[${this.email}] Starting Microsoft Rewards Grind`);
        console.log(`[${this.email}] ========================================\n`);

        try {
            await this._getVerificationToken();
            await this._getdashboardData();




            // 1. Report Dashboard Impression
            await this.reportDashboardImpression();
            await this._delay(this.options.delayBetweenTasks);

            //1.1.  Check for WeclomeTour
            await this.WelcomeTour()
            await this._delay(this.options.delayBetweenTasks);


            // 2. Process Daily Sets
            await this.processDailySets();
            await this._delay(this.options.delayBetweenTasks);

            // 3. Process More Promotions (excluding search tasks)
            await this.processMorePromotions();
            await this._delay(this.options.delayBetweenTasks);

            // 4. Process Punch Cards
            await this.processPunchCards();
            await this._delay(this.options.delayBetweenTasks);

            // 5. Print execution summary
            this.printSummary();

            return this.executionLog;
        } catch (error) {
            console.error(
                `[${this.email}] Fatal error during execution:`,
                error.message
            );
            throw error;
        }
    }

    async WelcomeTour() {
        try {
            const WelcomeTourValid = this.dashboardData?.dashboard?.welcomeTour?.promotion
        if (WelcomeTourValid.complete) {
            return;
        } else {

            await this._reportActivity({
                id: WelcomeTourValid.offerId,
                hash: WelcomeTourValid.hash,
                activityAmount: WelcomeTourValid.activityProgress || 1,
            }, 1, 3);

            console.log(
                `[${this.email}] ✓ WelcomeTour  reported successfully`
            );
        }
        } catch (error) {
            console.log(error);
            return;
        }   
    }
    /**
     * 
     * Report dashboard impression to earn initial points
     */
    async reportDashboardImpression() {
        const impressionTask =
            this.dashboardData?.dashboard?.userStatus?.dashboardImpression;

        if (!impressionTask || impressionTask.complete) {
            console.log(
                `[${this.email}] Dashboard impression already completed or not available`
            );
            return;
        }

        console.log(`[${this.email}] Reporting dashboard impression...`);

        try {
            await this._reportActivity({
                id: impressionTask.offerId,
                hash: impressionTask.hash,
                activityAmount: impressionTask.activityProgress || 1,
            });

            this.executionLog.completed.push({
                type: "Dashboard Impression",
                offerId: impressionTask.offerId,
                points: 0,
            });

            console.log(
                `[${this.email}] ✓ Dashboard impression reported successfully`
            );
        } catch (error) {
            console.error(
                `[${this.email}] ✗ Failed to report dashboard impression:`,
                error.message
            );
            this.executionLog.failed.push({
                type: "Dashboard Impression",
                offerId: impressionTask.offerId,
                error: error.message,
            });
        }
    }

    /**
     * Process all daily set tasks
     */
    async processDailySets() {
        const dailySets = this.dashboardData?.dashboard?.dailySetPromotions;

        if (!dailySets) {
            console.log(`[${this.email}] No daily sets available`);
            return;
        }

        console.log(`\n[${this.email}] === Processing Daily Sets ===`);

        // Get today's date in the format used in the JSON (MM/DD/YYYY)
        const today = new Date().toLocaleDateString("en-US", {
            month: "2-digit",
            day: "2-digit",
            year: "numeric",
        });

        const todaysTasks = dailySets[today];

        console.log({ todaysTasks });
        if (!todaysTasks || todaysTasks.length === 0) {
            console.log(`[${this.email}] No daily set tasks for today (${today})`);
            return;
        }

        console.log(
            `[${this.email}] Found ${todaysTasks.length} daily set tasks for ${today}`
        );

        for (const task of todaysTasks) {
            if (task.complete) {
                console.log(`[${this.email}] Skipping completed task: ${task.title}`);
                this.executionLog.skipped.push({
                    type: "Daily Set",
                    task: task.title,
                    reason: "Already completed",
                });
                continue;
            }

            await this._processTask(task, "Daily Set");
            await this._delay(this.options.delayBetweenTasks);
        }
    }

    /**
     * Process more promotions (promotional items)
     */
    async processMorePromotions() {
        const morePromotions = this.dashboardData?.dashboard?.morePromotions;

        if (!morePromotions || morePromotions.length === 0) {
            console.log(`[${this.email}] No more promotions available`);
            return;
        }

        console.log(`\n[${this.email}] === Processing More Promotions ===`);
        console.log(
            `[${this.email}] Found ${morePromotions.length} promotional items`
        );

        for (const promotion of morePromotions) {
            // Skip if already completed
            if (promotion.complete) {
                console.log(
                    `[${this.email}] Skipping completed promotion: ${promotion.title}`
                );
                this.executionLog.skipped.push({
                    type: "Promotion",
                    task: promotion.title,
                    reason: "Already completed",
                });
                continue;
            }

            // Skip search-related tasks
            if (this._isSearchTask(promotion)) {
                console.log(`[${this.email}] Skipping search task: ${promotion.title}`);
                this.executionLog.skipped.push({
                    type: "Promotion",
                    task: promotion.title,
                    reason: "Search task (excluded by user)",
                });
                continue;
            }

            await this._processTask(promotion, "Promotion");
            await this._delay(this.options.delayBetweenTasks);
        }
    }

    /**
     * Process punch cards
     */
    async processPunchCards() {
        const punchCards = this.dashboardData?.dashboard?.punchCards;

        if (!punchCards || punchCards.length === 0) {
            console.log(`[${this.email}] No punch cards available`);
            return;
        }

        console.log(`\n[${this.email}] === Processing Punch Cards ===`);
        console.log(`[${this.email}] Found ${punchCards.length} punch cards`);

        for (const punchCard of punchCards) {
            const parent = punchCard.parentPromotion;

            if (!parent) continue;

            // Skip if parent is completed
            if (parent.complete) {
                console.log(
                    `[${this.email}] Skipping completed punch card: ${parent.title}`
                );
                this.executionLog.skipped.push({
                    type: "Punch Card",
                    task: parent.title,
                    reason: "Already completed",
                });
                continue;
            }

            console.log(`[${this.email}] Processing punch card: ${parent.title}`);

            // Process child promotions within the punch card
            const children = punchCard.childPromotions || [];

            for (const child of children) {
                if (child.complete) {
                    console.log(
                        `[${this.email}]   - Skipping completed child task: ${child.title}`
                    );
                    continue;
                }

                // Skip search-related child tasks
                if (this._isSearchTask(child)) {
                    console.log(
                        `[${this.email}]   - Skipping search child task: ${child.title}`
                    );
                    this.executionLog.skipped.push({
                        type: "Punch Card Child",
                        task: `${parent.title} > ${child.title}`,
                        reason: "Search task (excluded by user)",
                    });
                    continue;
                }

                await this._processTask(child, "Punch Card Child", parent.title);
                await this._delay(this.options.delayBetweenTasks);
            }
        }
    }

    /**
     * Process a single task
     * @private
     */
    async _processTask(task, taskType, parentTitle = null) {
        const displayTitle = parentTitle
            ? `${parentTitle} > ${task.title}`
            : task.title;
        console.log(`[${this.email}] Processing ${taskType}: ${displayTitle}`);

        console.log(task.promotionType);
        try {
            // Handle different promotion types
            switch (task.promotionType) {
                case "urlreward":
                    await this._handleUrlReward(task);
                    break;
                case "welcometour":
                    await this._handleUrlReward(task);
                    break;
                case "quiz":
                    await this._handleQuiz(task);
                    break;
                default:
                    console.log(
                        `[${this.email}]   Type: ${task.promotionType} - Attempting generic completion`
                    );
                    console.log(await this._reportActivity({
                        id: task.offerId,
                        hash: task.hash,
                        activityAmount: 1,
                    }));
            }

            const points = task.pointProgressMax || 0;
            this.executionLog.completed.push({
                type: taskType,
                task: displayTitle,
                points: points,
            });
            this.executionLog.totalPoints += points;

            console.log(
                `[${this.email}] ✓ Completed: ${displayTitle} (+${points} points)`
            );
        } catch (error) {
            console.error(
                `[${this.email}] ✗ Failed: ${displayTitle} - ${error.message}`
            );
            this.executionLog.failed.push({
                type: taskType,
                task: displayTitle,
                error: error.message,
            });
        }
    }

    /**
     * Handle URL reward tasks
     * @private
     */
    async _handleUrlReward(task) {
        console.log(`_handleUrlReward for ${task.attributes.title}`);
        // First, visit the destination URL if available
        if (task.destinationUrl) {
            try {
                await this.axiosInstance.get(task.destinationUrl, {
                    headers: {
                        Referer: "https://rewards.bing.com/",
                    },
                });
                console.log(await this._reportActivity({
                    id: task.offerId,
                    hash: task.hash,
                    activityAmount: 1,
                }));
                console.log(`[${this.email}]   - Visited destination URL`);
            } catch (error) {
                console.log(
                    `[${this.email}]   - Warning: Failed to visit destination URL: ${error.message}`
                );
            }
        }

        // Report the activity
        await this._reportActivity({
            id: task.offerId,
            hash: task.hash,
            activityAmount: 1,
        });
    }

    /**
     * Handle quiz tasks
     * @private
     */
    async _handleQuiz(task) {
        console.log(`[${this.email}]   - Quiz detected, visiting quiz URL...`);

        if (task.destinationUrl) {
            try {
                // Visit the quiz page
                await this.axiosInstance.get(task.destinationUrl);
                await this._delay(3000); // Wait for quiz to load

                // Report completion
                await this._reportActivityBing({
                    id: task.offerId,
                    hash: task.hash,
                    activityAmount: 1,
                }, 1, 3);


            } catch (error) {
                console.log(
                    `[${this.email}]   - Warning: Quiz processing may be incomplete: ${error.message}`
                );
                // Still attempt to report activity
                await this._reportActivity({
                    id: task.offerId,
                    hash: task.hash,
                    activityAmount: 1,
                });
            }
        }
    }
    async _reportActivityBing(data, retryCount = 0, RepeteReq = 1) {
        const url = "https://www.bing.com/bingqa/ReportActivity";
        
        // Get cookies from bing.com domain
        const bingCookies = await this.cookieJar.getCookies('https://bing.com');
        const cookieString = bingCookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');
        
        // Create JSON payload instead of URLSearchParams
        const payload = JSON.stringify({
            UserId: null,
            TimeZoneOffset: -330,
            OfferId: data.id,
            ActivityCount: 1,
            QuestionIndex: "-1",
        });
    
        try {
            const response = await this.axiosInstance.post(url, payload, {
                params: {
                    ajaxreq: "1", // Add ajaxreq parameter to URL
                },
                headers: {
                    'accept': '*/*',
                    'accept-language': 'en-GB,en;q=0.9',
                    'cache-control': 'no-cache',
                    'content-type': 'text/plain;charset=UTF-8', // Changed from application/x-www-form-urlencoded
                    'dnt': '1',
                    'origin': 'https://www.bing.com',
                    'pragma': 'no-cache',
                    'referer': 'https://www.bing.com/search',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-origin',
                    'Cookie': cookieString, // Use cookies from bing.com
                }
            });
            
            console.log(response);
            
            if (response.status === 200) {
                // Check if we need to repeat the request
                if (RepeteReq > 1) {
                    console.log(
                        `[${this.email}] - Repeating request ${RepeteReq - 1} more time(s) for activity: ${data.id}`
                    );
                    await this._delay(2000);
                    return this._reportActivityBing(data, 0, RepeteReq - 1);
                }
                return response.data;
            }
        } catch (error) {
            if (retryCount < this.options.maxRetries) {
                console.log(
                    `[${this.email}] - Retry ${retryCount + 1}/${this.options.maxRetries} for activity: ${data.id}`
                );
                await this._delay(2000);
                return this._reportActivityBing(data, retryCount + 1, RepeteReq);
            }
            throw error;
        }
    }
    // async _reportActivityBing(data, retryCount = 0, RepeteReq = 1) {
    //     const url = "https://www.bing.com/bingqa/ReportActivity?ajaxreq=1";

    //     // Get verification token from cookies
    //     const bingCookies = await this.cookieJar.getCookies('https://bing.com');
    //     const cookieString = bingCookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');


    //     const payload = new URLSearchParams({
    //         UserId: null,
    //         TimeZoneOffset: -330,
    //         OfferId: data.id,
    //         ActivityCount: 1,
    //         QuestionIndex: "-1",
    //     });

    //     console.log(payload);
    //     try {
    //         const response = await this.axiosInstance.post(url, payload.toString(), {
    //             params: {
    //                 "X-Requested-With": "XMLHttpRequest",
    //             },
    //             headers: {
    //                 'Cookie': cookieString, // Explicitly set cookies from bing.com
    //                 'Referer': 'https://www.bing.com/', // Add referer
    //                 'Origin': 'https://www.bing.com'
    //             }
    //         });
    //         console.log(response);

    //         if (response.status === 200) {
    //             // Check if we need to repeat the request
    //             if (RepeteReq > 1) {
    //                 console.log(
    //                     `[${this.email}] - Repeating request ${RepeteReq - 1} more time(s) for activity: ${data.id}`
    //                 );
    //                 await this._delay(2000); // Add delay between repeats
    //                 return this._reportActivityBing(data, 0, RepeteReq - 1);
    //             }
    //             return response.data;
    //         }
    //     } catch (error) {
    //         console.log(error);
    //         if (retryCount < this.options.maxRetries) {
    //             console.log(
    //                 `[${this.email}]   - Retry ${retryCount + 1}/${this.options.maxRetries
    //                 } for activity: ${data.id}`
    //             );
    //             await this._delay(2000);
    //             return this._reportActivityBing(data, retryCount + 1, RepeteReq);
    //         }
    //         throw error;
    //     }
    // }

    /**
     * Report activity to Microsoft Rewards API
     * @private
     */
    async _reportActivity(data, retryCount = 0, RepeteReq = 1) {
        const url = "https://rewards.bing.com/api/reportactivity";

        // Get verification token from cookies
        
        var verificationToken = this.verificationToken;
        console.log(verificationToken);
        const payload = new URLSearchParams({
            id: data.id,
            hash: data.hash,
            timeZone: this.options.timezone,
            activityAmount: data.activityAmount || 1,
            dbs: "0",
            form: "",
            type: "",
            __RequestVerificationToken: verificationToken,
        });

        try {
            const response = await this.axiosInstance.post(url, payload.toString(), {
                params: {
                    "X-Requested-With": "XMLHttpRequest",
                },
            });

           
            if (response.status === 200) {
                // Check if we need to repeat the request
                if (RepeteReq > 1) {
                    console.log(
                        `[${this.email}] - Repeating request ${RepeteReq - 1} more time(s) for activity: ${data.id}`
                    );
                    await this._delay(2000); // Add delay between repeats
                    return this._reportActivity(data, 0, RepeteReq - 1);
                }
                return response.data;
            }
        } catch (error) {
            if (retryCount < this.options.maxRetries) {
                console.log(
                    `[${this.email}]   - Retry ${retryCount + 1}/${this.options.maxRetries
                    } for activity: ${data.id}`
                );
                await this._delay(2000);
                return this._reportActivity(data, retryCount + 1, RepeteReq);
            }
            throw error;
        }
    }

    /**
     * Get CSRF verification token from cookies
     * @private
     */
    async _getVerificationToken() {
        try {
            const RewardsHomePage = await this.axiosInstance.get(
                "https://rewards.bing.com/"
            );
            const $ = cheerio.load(RewardsHomePage.data);
            const tokenInput = $('input[name="__RequestVerificationToken"]');
            const tokenValue = tokenInput.val();

            this.verificationToken = tokenValue;
            return tokenValue;
        } catch (error) {
            throw error;
        }

        // const cookies = await this.cookieJar.getCookies('https://rewards.bing.com');
        // const antiforgeryCookie = cookies.find(c => c.key.includes('Antiforgery'));

        // if (antiforgeryCookie) {
        //     // Extract token from cookie value
        //     // The actual token extraction might need adjustment based on cookie format
        //     return antiforgeryCookie.value;
        // }

        // // If no token in cookies, we might need to fetch it from the page
        // console.log(`[${this.email}] Warning: No verification token found in cookies`);
        // return '';
    }

    async _getdashboardData() {
        try {
            var timeStamp = Date.now();
            var dashboardData = await this.axiosInstance.get(
                `https://rewards.bing.com/api/getuserinfo?type=1&X-Requested-With=XMLHttpRequest&_=${timeStamp}`
            );
            // fs.writeFile("./dashboardData.json", JSON.stringify(dashboardData.data, null, 2), (e, r) => {

            // })
            this.dashboardData = dashboardData.data;
        } catch (error) {
            throw error;
        }
    }
    /**
     * Check if a task is search-related
     * @private
     */
    _isSearchTask(task) {
        if (!this.options.skipSearchTasks) return false;

        const searchKeywords = [
            "search",
            "bing search",
            "searches",
            "desktop search",
            "mobile search",
            "edge search",
        ];

        const title = (task.title || "").toLowerCase();
        const description = (task.description || "").toLowerCase();
        const promotionType = (task.promotionType || "").toLowerCase();

        return searchKeywords.some(
            (keyword) =>
                title.includes(keyword) ||
                description.includes(keyword) ||
                promotionType.includes("search")
        );
    }

    /**
     * Import cookie jar from JSON string
     * @private
     */
    _importCookieJar(cookieJarString) {
        if (!cookieJarString) return null;

        try {
            const data = JSON.parse(cookieJarString);
            let cookieData;

            // Handle new format (wrapped with metadata) and old format (raw cookie jar)
            if (data.cookies && data.metadata) {
                cookieData = data.cookies;
            } else if (data.storeType === "MemoryCookieStore") {
                cookieData = data;
            } else if (
                data.cookies &&
                data.cookies.storeType === "MemoryCookieStore"
            ) {
                console.log(
                    `[${this.email}] Detected and correcting malformed cookie jar.`
                );
                cookieData = data.cookies;
            } else {
                throw new Error("Serialized cookie jar is in an unknown format.");
            }

            return CookieJar.deserializeSync(cookieData);
        } catch (err) {
            console.error(
                `[${this.email}] Failed to parse cookie jar. Starting fresh.`,
                err
            );
            return null;
        }
    }

    /**
     * Export cookie jar to JSON string
     */
    exportCookieJar() {
        const jarData = this.cookieJar.toJSON();
        return JSON.stringify({
            cookies: jarData,
            metadata: {
                lastExported: new Date().toISOString(),
                email: this.email,
            },
        });
    }

    /**
     * Delay execution
     * @private
     */
    async _delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Print execution summary
     */
    printSummary() {
        console.log(`\n[${this.email}] ========================================`);
        console.log(`[${this.email}] Execution Summary`);
        console.log(`[${this.email}] ========================================`);
        console.log(
            `[${this.email}] ✓ Completed: ${this.executionLog.completed.length} tasks`
        );
        console.log(
            `[${this.email}] ✗ Failed: ${this.executionLog.failed.length} tasks`
        );
        console.log(
            `[${this.email}] ⊘ Skipped: ${this.executionLog.skipped.length} tasks`
        );
        console.log(
            `[${this.email}] 🏆 Total Points Earned: ${this.executionLog.totalPoints}`
        );
        console.log(`[${this.email}] ========================================\n`);

        if (this.executionLog.failed.length > 0) {
            console.log(`[${this.email}] Failed Tasks:`);
            this.executionLog.failed.forEach((f) => {
                console.log(`[${this.email}]   - ${f.task}: ${f.error}`);
            });
        }
    }

    /**
     * Get detailed execution report
     */
    getReport() {
        var ReportData = {
            email: this.email,
            timestamp: new Date().toISOString(),
            summary: {
                completed: this.executionLog.completed.length,
                failed: this.executionLog.failed.length,
                skipped: this.executionLog.skipped.length,
                totalPoints: this.executionLog.totalPoints,
            },
            details: this.executionLog,
        };
        return ReportData;
    }
}

// const SCJc = require("./cki.json")
// const cookieJarString = JSON.stringify(SCJc);

// async function main() {
//     var RG = new RewardsGrind(null, 'JustinSparks5654@hotmail.com', cookieJarString)
//     await RG.execute()
//     var report = RG.getReport()
//     console.log({ report });

// }
// main()

module.exports = RewardsGrind;
