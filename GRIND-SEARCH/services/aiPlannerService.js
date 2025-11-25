const { Get: getTrends } = require('../utils/trends');
const fallbackQueries = require('../utils/fallback-queries');

const PC_SEARCHES_PER_DAY = 30;
const MOBILE_SEARCHES_PER_DAY = 25;

class AIPlannerService {

    /**
     * Generates a random, timezone-correct Date object within a given time window.
     * @param {string} planDate - The date for the plan in "yyyy-MM-dd" format.
     * @param {string} timeZone - The IANA timezone string (e.g., 'America/New_York').
     * @param {function} fromZonedTime - The imported fromZonedTime function.
     * @returns {Date} - A UTC Date object representing a random time on that day in the target zone.
     * @private
     */
    // static _getRandomTimeInWindow(planDate, timeZone, fromZonedTime) {
    //     const startHour = 7; // 7 AM
    //     const endHour = 23; // 11 PM (tasks will be scheduled up to 22:59:59)
        
    //     const hour = Math.floor(startHour + Math.random() * (endHour - startHour));
    //     const minute = Math.floor(Math.random() * 60);
    //     const second = Math.floor(Math.random() * 60);

    //     // Pad with leading zeros to ensure correct ISO 8601 format
    //     const hourStr = String(hour).padStart(2, '0');
    //     const minStr = String(minute).padStart(2, '0');
    //     const secStr = String(second).padStart(2, '0');

    //     // Construct a full date-time string that represents the local time in the target zone
    //     const dateTimeString = `${planDate}T${hourStr}:${minStr}:${secStr}`;
        
    //     // Use fromZonedTime to create the correct UTC Date object from that string
    //     return fromZonedTime(dateTimeString, timeZone);
    // }
    static _getRandomTimeInWindow(planDate) {
        const startHour = 7;  // 7 AM
        const endHour = 23;   // 11 PM (tasks will be scheduled up to 22:59:59)
        
        // Parse the plan date in local timezone
        const date = new Date(planDate + 'T00:00:00');
        
        // Calculate random time components
        const randomHour = Math.floor(Math.random() * (endHour - startHour)) + startHour;
        const randomMinute = Math.floor(Math.random() * 60);
        const randomSecond = Math.floor(Math.random() * 60);
        const randomMs = Math.floor(Math.random() * 1000);
        
        // Set the random time
        date.setHours(randomHour, randomMinute, randomSecond, randomMs);
        
        // Get timezone offset in minutes (e.g., IST is -330 minutes from UTC)
        const timezoneOffsetMinutes = date.getTimezoneOffset();
        
        // Subtract the offset to compensate for MongoDB's UTC conversion
        // When MongoDB converts to UTC, it will add this offset back, giving us our local time
        const adjustedDate = new Date(date.getTime() - (timezoneOffsetMinutes * 60 * 1000));
        
        return adjustedDate;
      }
      
    
    /**
     * Shuffles an array in place.
     * @param {Array} array The array to shuffle.
     * @returns {Array} The shuffled array.
     * @private
     */
    static _shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /**
     * Generates a complete daily plan of tasks using Google Trends with a fallback.
     * The schedule is based on the provided date and is timezone-aware.
     * @param {string} planDate - The date for the plan in "yyyy-MM-dd" format.
     * @returns {Promise<object[]>} - An array of task objects.
     */
    static async generateDailyPlan(planDate) {
        const { fromZonedTime } = await import('date-fns-tz');

        if (!planDate || typeof planDate !== 'string') {
            console.error('[Planner] CRITICAL: generateDailyPlan was called without a valid planDate string. Aborting plan generation.');
            return [];
        }

        console.log(`[Planner] Generating a daily plan for ${planDate} using Google Trends...`);
        const totalQueriesNeeded = PC_SEARCHES_PER_DAY + MOBILE_SEARCHES_PER_DAY;
        let queries = [];

        try {
            queries = await getTrends(totalQueriesNeeded);
        } catch (error) {
            console.error('[Planner] An error occurred while fetching Google Trends:', error);
            queries = [];
        }

        if (queries.length < totalQueriesNeeded) {
            console.warn(`[Planner] Warning: Could only fetch ${queries.length}/${totalQueriesNeeded} queries. Using fallback list.`);
            queries = this._shuffleArray([...fallbackQueries]).slice(0, totalQueriesNeeded);
        }
        
        if (queries.length === 0) {
             console.error('[Planner] CRITICAL: Both Google Trends and the fallback are empty. Cannot generate a plan.');
             return [];
        }

        const tasks = [];
        const timeZone = process.env.TIMEZONE;
        
        const shuffledQueries = this._shuffleArray(queries);
        let queryIndex = 0;


 
        // TURN OF PC -||- MOBILE TASK FOR NOW:
        for (let i = 0; i < PC_SEARCHES_PER_DAY; i++) {
            tasks.push({
                taskType: 'SEARCH',
                query: shuffledQueries[queryIndex++ % shuffledQueries.length],
                device: 'PC',
                executeAt: this._getRandomTimeInWindow(planDate),
                sessionId: `session-pc-${Math.floor(Math.random() * 5)}`,
                status: 'PENDING'
            });
        }
        
        // for (let i = 0; i < MOBILE_SEARCHES_PER_DAY; i++) {
        //     tasks.push({
        //         taskType: 'SEARCH',
        //         query: shuffledQueries[queryIndex++ % shuffledQueries.length],
        //         device: 'MOBILE',
        //         executeAt: this._getRandomTimeInWindow(planDate),
        //         sessionId: `session-mobile-${Math.floor(Math.random() * 8)}`,
        //         status: 'PENDING'
        //     });
        // }
        
        tasks.push({
            taskType: 'DAILY_GRIND',
            query: null,
            device: 'PC',
            executeAt: this._getRandomTimeInWindow(planDate),
            sessionId: null,
            status: 'PENDING'
        });

        tasks.sort((a, b) => a.executeAt.getTime() - b.executeAt.getTime());
        
        console.log(`[Planner] Successfully generated plan with ${tasks.length} tasks.`);
        return tasks;
    }
}

module.exports = AIPlannerService;

