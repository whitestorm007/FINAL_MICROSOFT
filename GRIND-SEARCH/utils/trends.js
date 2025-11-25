const googleTrends = require('google-trends-api');

/**
 * Parses the nested structure of the google-trends-api response to get a flat list of queries.
 * @param {object} data - The raw JSON data from the API.
 * @returns {string[]} An array of trending search queries.
 */
function extractTrendingSearches(data) {
    let results = [];
    if (data && data.default && data.default.trendingSearchesDays) {
        data.default.trendingSearchesDays.forEach(day => {
            day.trendingSearches.forEach(search => {
                results.push(search.title.query);
                if (search.relatedQueries) {
                    search.relatedQueries.forEach(relatedQuery => {
                        results.push(relatedQuery.query);
                    });
                }
            });
        });
    }
    return results;
}

/**
 * Parses the YYYYMMDD date string from the API into a YYYY-MM-DD format for the next request.
 * @param {string} dateStr - The date string in YYYYMMDD format.
 * @returns {string} The formatted date string.
 */
function parseDate(dateStr) {
    if (dateStr.length !== 8 || isNaN(dateStr)) {
        console.error('Invalid date format from Google Trends API. Cannot continue fetching.');
        return null;
    }
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return `${year}-${month}-${day}`;
}

/**
 * A recursive function that fetches daily trends until the desired number of queries is met.
 * @param {string} date - The starting date for fetching trends (YYYY-MM-DD).
 * @param {number} max - The total number of queries desired.
 * @param {string[]} existingQueries - An accumulator for the queries found so far.
 * @returns {Promise<string[]>} A list of trend queries.
 */
async function getTrendsRecursive(date, max, existingQueries = []) {
    try {
        let trendData = await googleTrends.dailyTrends({ trendDate: new Date(date), geo: 'US' });
        trendData = JSON.parse(trendData);

        const newQueries = extractTrendingSearches(trendData);
        const allQueries = [...existingQueries, ...newQueries];

        // If we have enough queries, return the exact amount requested.
        if (allQueries.length >= max) {
            return allQueries.slice(0, max);
        }

        // Otherwise, get the date for the next request and recurse.
        const nextDateStr = parseDate(trendData.default.endDateForNextRequest);
        if (nextDateStr) {
            return await getTrendsRecursive(nextDateStr, max, allQueries);
        } else {
            return allQueries; // Return what we have if the next date is invalid
        }
    } catch (error) {
        console.error(`[Trends] Failed to fetch trends for date ${date}:`, error.message);
        // Return what we've gathered so far in case of an error
        return existingQueries;
    }
}

/**
 * The main exported function to get a specified number of trending queries.
 * @param {number} limit - The number of queries to fetch.
 * @returns {Promise<string[]>} A promise that resolves to an array of queries.
 */
async function Get(limit) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const startDate = `${yyyy}-${mm}-${dd}`;
    
    console.log(`[Trends] Starting to fetch ${limit} Google Trends queries from date: ${startDate}`);
    const results = await getTrendsRecursive(startDate, limit);
    console.log(`[Trends] Successfully fetched ${results.length} queries.`);
    return results;
}

module.exports.Get = Get;
