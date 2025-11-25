// const { zonedTimeToUtc, setHours, setMinutes, setSeconds, startOfDay } = require('date-fns-tz');

// // Constants for the plan
// const PC_SEARCHES_PER_DAY = 35;
// const MOBILE_SEARCHES_PER_DAY = 25;

// class AIPlannerService {

//     /**
//      * Simulates a call to a generative AI to get search queries.
//      * In a real application, this would be an API call to a service like OpenAI or Google AI.
//      * @param {string} prompt - The prompt for the AI.
//      * @returns {Promise<string[]>} - A promise that resolves to an array of search query strings.
//      * @private
//      */
   
//     /**
//      * Generates a random Date object within a given time window for today.
//      * @param {Date} dayStart - The start of the day in the target timezone.
//      * @param {number} startHour - The starting hour of the window (0-23).
//      * @param {number} endHour - The ending hour of the window (0-23).
//      * @returns {Date} - A UTC Date object.
//      * @private
//      */
//     static _getRandomTimeInWindow(dayStart, startHour, endHour) {
//         const hour = startHour + Math.random() * (endHour - startHour);
//         const minute = Math.random() * 60;
//         const second = Math.random() * 60;

//         let date = setHours(dayStart, hour);
//         date = setMinutes(date, minute);
//         date = setSeconds(date, second);
//         return date; // date-fns-tz objects are standard Date objects
//     }

//     /**
//      * Generates a complete daily plan of tasks for a given persona.
//      * @param {object} persona - The Mongoose document for the persona.
//      * @returns {Promise<object[]>} - An array of task objects.
//      */
//     static async generateDailyPlan(persona) {
//         // --- 1. Construct the AI Prompt ---
//         const prompt = `
//             Generate a list of realistic Bing search queries for a person with this profile:
//             - Profession: ${persona.profession}
//             - Interests: ${persona.interests.join(', ')}
//             - Daily Routine: ${persona.dailyRoutine}
//             The queries should be varied, natural, and reflect a typical day's browsing habits for this person. Include a mix of professional, hobby-related, and general life queries.
//         `;

//         // --- 2. Get Queries from the (Mock) AI ---
//         const queries = await this._callMockAI(prompt);
//         if (queries.length < (PC_SEARCHES_PER_DAY + MOBILE_SEARCHES_PER_DAY)) {
//             throw new Error("Mock AI did not generate enough queries.");
//         }

//         const tasks = [];
//         const timeZone = process.env.TIMEZONE;
//         const todayStart = startOfDay(new Date()); // Today at 00:00 in the system's local TZ. `zonedTimeToUtc` will correct this.

//         // --- 3. Define Activity Windows based on Routine ---
//         // This is a simplified parser. A more complex one could use regex or keyword analysis.
//         const routine = persona.dailyRoutine.toLowerCase();
//         const windows = [];
//         if (routine.includes("early") || routine.includes("morning")) {
//             windows.push({ name: 'morning-routine', start: 6, end: 9, device: 'MOBILE', count: 8 });
//         }
//         if (routine.includes("lunch")) {
//             windows.push({ name: 'lunch-break', start: 12, end: 14, device: 'MOBILE', count: 7 });
//         }
//         if (routine.includes("evening") || routine.includes("after work")) {
//             windows.push({ name: 'evening-pc', start: 19, end: 23, device: 'PC', count: PC_SEARCHES_PER_DAY });
//             windows.push({ name: 'evening-mobile', start: 19, end: 23, device: 'MOBILE', count: MOBILE_SEARCHES_PER_DAY - 15 });
//         }

//         // --- 4. Create and Schedule SEARCH Tasks ---
//         let queryIndex = 0;
//         for (const window of windows) {
//             for (let i = 0; i < window.count; i++) {
//                 if (queryIndex >= queries.length) break;

//                 const executeAt = this._getRandomTimeInWindow(todayStart, window.start, window.end);
                
//                 tasks.push({
//                     taskType: 'SEARCH',
//                     query: queries[queryIndex++],
//                     device: window.device,
//                     executeAt: zonedTimeToUtc(executeAt, timeZone), // Convert the generated time to a UTC Date
//                     sessionId: `${window.name}-${todayStart.toISOString().split('T')[0]}`,
//                     status: 'PENDING'
//                 });
//             }
//         }
        
//         // --- 5. Add DAILY_GRIND Tasks ---
//         // Let's schedule these at the beginning and end of the day.
//         tasks.push({
//             taskType: 'DAILY_GRIND',
//             query: null,
//             device: 'PC',
//             executeAt: zonedTimeToUtc(this._getRandomTimeInWindow(todayStart, 7, 8), timeZone),
//             sessionId: null,
//             status: 'PENDING'
//         });

//         // --- 6. Sort and Return ---
//         tasks.sort((a, b) => a.executeAt - b.executeAt);
//         return tasks;
//     }
// }

// module.exports = AIPlannerService;