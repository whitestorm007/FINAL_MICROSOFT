// Import necessary packages
const mongoose = require('mongoose');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Import models
const RewardsAccountModel = require('./schema/new');
const PersonaModel = require('./schema/persona');

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    MONGO_URI: 'mongodb+srv://admin:microsoft@microsoft.qsostr2.mongodb.net/microsoft',
    GEMINI_API_KEY: 'AIzaSyDsaEIzKGG-UntvBM2YE0eH62WkS98FdGM',
    GEMINI_MODEL: 'gemini-2.5-pro',
    CRON_SCHEDULE: '* * * * *', // Every minute
    TASK_LOCK_TIMEOUT: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
};

// ============================================
// INITIALIZATION
// ============================================
const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: CONFIG.GEMINI_MODEL });

let isTaskRunning = false;

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get today's date in YYYY-MM-DD format
 * @returns {string} Date string
 */
function getTodayDateString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Get date from X hours ago
 * @param {number} hours - Number of hours ago
 * @returns {Date}
 */
function getDateXHoursAgo(hours) {
    const now = new Date();
    return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

// ============================================
// DATABASE FUNCTIONS
// ============================================

/**
 * Connect to MongoDB database
 * @throws {Error} If connection fails
 */
async function connectToDatabase() {
    try {
        await mongoose.connect(CONFIG.MONGO_URI);
        console.log('✓ Successfully connected to MongoDB');
    } catch (error) {
        console.error('✗ Error connecting to MongoDB:', error.message);
        process.exit(1);
    }
}

/**
 * Find and claim an eligible job for processing
 * @param {Date} now - Current timestamp
 * @param {string} todayDateString - Today's date string
 * @returns {Promise<Object|null>} Claimed job or null
 */
async function claimEligibleJob(now, todayDateString) {
    const oneDayAgo = getDateXHoursAgo(24);

    const query = {
        // Job must be enabled and active
        isEnabled: true,
        accountStatus: 'ACTIVE',
        nextSessionEligible: { $lte: now },

        // Job must be IDLE or stuck in RUNNING state
        $or: [
            { jobStatus: 'IDLE' },
            { jobStatus: 'RUNNING', lastSession: { $lte: oneDayAgo } }
        ],

        // Job needs work if any of these conditions are true
        $or: [
            // Has pending tasks for today that are due
            {
                'dailyPlan.planDate': todayDateString,
                'dailyPlan.tasks': {
                    $elemMatch: {
                        status: 'PENDING',
                        executeAt: { $lte: now }
                    }
                }
            },
            // Daily plan is outdated or missing
            { 'dailyPlan.planDate': { $ne: todayDateString } },
            { dailyPlan: { $exists: false } },
            // Missing persona
            { persona: { $exists: false } }
        ]
    };

    const update = {
        $set: {
            jobStatus: 'RUNNING',
            lastSession: now,
            jobMessage: `Job claimed by worker at ${now.toISOString()}`
        }
    };

    const options = {
        new: true,
        sort: { nextSessionEligible: 1 }
    };

    return await RewardsAccountModel.findOneAndUpdate(query, update, options);
}

/**
 * Update job with new daily plan
 * @param {string} jobId - Job ID
 * @param {string} todayDateString - Today's date string
 * @param {Array} tasks - Array of tasks
 */
async function updateJobDailyPlan(jobId, todayDateString, tasks) {
    await RewardsAccountModel.updateOne(
        { _id: jobId },
        {
            $set: {
                dailyPlan: {
                    planDate: todayDateString,
                    tasks: tasks
                }
            }
        }
    );
}

// ============================================
// AI GENERATION FUNCTIONS
// ============================================

/**
 * Generate daily plan using Gemini AI
 * @param {Object} persona - Persona object
 * @returns {Promise<Array>} Array of daily tasks
 */
async function generateDailyPlan(persona, date) {
    const prompt = `
You are a Hyper-Realistic Human Behavior Simulator. Generate a flat list of daily tasks for a user, making their search queries timely, specific, and deeply rooted in their persona's real-world environment.

**CRITICAL RULES:**
1. **Hyper-Realism is Key:** Queries must reflect real-world, current, and local events.
2. **Strict JSON Output:** Return ONLY a valid JSON array, no markdown or explanations.
3. **Adhere to Schema:** Every object must follow the output schema exactly.

**Persona:**
${JSON.stringify(persona, null, 2)}

**Task Requirements for ${date}:**
- DAILY_GRIND Tasks: 3
- PC Searches: 20
- Mobile Searches: 30

**Output Schema:**
{
  "taskType": "string (DAILY_GRIND or SEARCH)",
  "query": "string or null",
  "device": "string (PC or MOBILE)",
  "executeAt": "NEEDS_SCHEDULING",
  "sessionId": "string or null",
  "status": "PENDING"
}

**Example Output:**
[
  {
    "taskType": "DAILY_GRIND",
    "query": null,
    "device": "PC",
    "executeAt": "NEEDS_SCHEDULING",
    "sessionId": null,
    "status": "PENDING"
  },
  {
    "taskType": "SEARCH",
    "query": "heirloom tomato disease identification",
    "device": "PC",
    "executeAt": "NEEDS_SCHEDULING",
    "sessionId": "gardening-research-20251003",
    "status": "PENDING"
  }
]

**Guidelines:**
1. Be Specific & Local: Use specific locations, stores, streets from persona's city
2. Incorporate Current Events: Include recent news, local sports, weather forecasts
3. Use Persona Interests: Create long-tail queries based on hobbies
4. Simulate Real Needs: Mix informational, navigational, and transactional queries
5. Follow Routine: Distribute tasks within persona's active hours
6. Realistic Pacing: 1-15 minute delays between tasks in a session

Generate the JSON array now:`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Clean markdown formatting
        const jsonString = text.replace(/```json\n?|\n?```/g, '').trim();
        const tasks = JSON.parse(jsonString);

        console.log(`✓ Generated ${tasks.length} tasks for daily plan`);
        return tasks;
    } catch (error) {
        console.error('✗ Error generating daily plan:', error.message);
        throw error;
    }
}

/**
 * Generate a new persona using Gemini AI
 * @returns {Promise<Object>} Generated persona object
 */
async function generatePersona() {
    const prompt = `
You are a creative character generator for a software simulation. Create a unique and detailed digital persona for a US-based individual.

Generate a single persona as a JSON object with these attributes:

1. **name**: A common full name
2. **profession**: A plausible job title
3. **interests**: Array of 3-4 specific hobbies (be creative and specific)
4. **dailyRoutine**: Brief description of typical day and online activity times
5. **techProfile**: Object with 'pc' and 'mobile' keys, each containing 'os' and 'browser'

Example format:
{
  "name": "Sarah Mitchell",
  "profession": "High School Biology Teacher",
  "interests": ["urban gardening", "true crime podcasts", "kayaking"],
  "dailyRoutine": "Online 10 AM - 1 PM and 7 PM - 10 PM CST",
  "techProfile": {
    "pc": { "os": "Windows 11", "browser": "Edge" },
    "mobile": { "os": "iOS 17", "browser": "Safari" }
  }
}

Generate the persona now (JSON only, no markdown):`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        const jsonString = text.replace(/```json\n?|\n?```/g, '').trim();
        const persona = JSON.parse(jsonString);

        console.log(`✓ Generated persona: ${persona.name}`);
        return persona;
    } catch (error) {
        console.error('✗ Error generating persona:', error.message);
        throw error;
    }
}

/**
 * Save persona to database
 * @param {Object} personaData - Persona object to save
 * @returns {Promise<Object>} Saved persona document
 */
async function savePersona(personaData) {
    try {
        const persona = new PersonaModel(personaData);
        await persona.save();
        console.log(`✓ Persona saved: ${personaData.name}`);
        return persona;
    } catch (error) {
        console.error('✗ Error saving persona:', error.message);
        throw error;
    }
}

// ============================================
// JOB PROCESSING FUNCTIONS
// ============================================

/**
 * Process a job that needs a new daily plan
 * @param {Object} job - Job object
 * @param {string} todayDateString - Today's date string
 */
async function processDailyPlanCreation(job, todayDateString) {
    console.log(`→ Job ${job._id}: Creating new daily plan`);

    if (!job.persona) {
        console.log(`✗ Job ${job._id}: Missing persona, cannot create plan`);
        return;
    }

    const persona = await PersonaModel.findById(job.persona);
    if (!persona) {
        console.log(`✗ Job ${job._id}: Persona not found in database`);
        return;
    }

    const dailyTasks = await generateDailyPlan(persona);
    await updateJobDailyPlan(job._id, todayDateString, dailyTasks);

    console.log(`✓ Job ${job._id}: Daily plan created with ${dailyTasks.length} tasks`);
}

/**
 * Process pending tasks for a job
 * @param {Object} job - Job object
 * @param {Date} now - Current timestamp
 * @param {string} todayDateString - Today's date string
 */
async function processPendingTasks(job, now, todayDateString) {
    if (!job.dailyPlan || job.dailyPlan.planDate !== todayDateString || !job.dailyPlan.tasks) {
        console.log(`→ Job ${job._id}: No valid daily plan to process`);
        return;
    }

    const pendingTasks = job.dailyPlan.tasks.filter(
        task => task.status === 'PENDING' && new Date(task.executeAt) <= now
    );

    if (pendingTasks.length > 0) {
        console.log(`→ Job ${job._id}: Found ${pendingTasks.length} pending tasks`);
        console.log('Tasks:', pendingTasks.map(t => ({
            type: t.taskType,
            query: t.query,
            device: t.device
        })));

        // TODO: Add actual task execution logic here
        // For example: executeTask(task) for each pending task
    } else {
        console.log(`→ Job ${job._id}: No pending tasks due at this time`);
    }
}

// ============================================
// MAIN SCHEDULER FUNCTION
// ============================================

/**
 * Main function executed by cron job
 * Finds eligible jobs, creates plans if needed, and processes pending tasks
 */
async function performScheduledTask() {
    // Check if previous task is still running
    if (isTaskRunning) {
        console.log('⚠ Previous task still running, skipping this cycle');
        return;
    }

    isTaskRunning = true;
    const startTime = new Date();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`⏰ Task started at ${startTime.toLocaleTimeString()}`);
    console.log(`${'='.repeat(60)}`);



    try {
        /**
 * Alternative: Get accounts grouped by email with all their pending tasks
 * Returns: Array with each account having an array of pending tasks
 */
        async function getAccountsWithPendingTasksGrouped() {
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const todayDateString = now.toISOString().split('T')[0];

            const pipeline = [
                // Stage 1: Match accounts
                {
                    $match: {
                        isEnabled: true,
                        accountStatus: 'ACTIVE',
                        nextSessionEligible: { $lte: now },
                        $or: [
                            { jobStatus: 'IDLE' },
                            { jobStatus: 'RUNNING', lastSession: { $lte: oneDayAgo } }
                        ],
                        'dailyPlan.planDate': todayDateString,
                        'dailyPlan.tasks': { $exists: true, $ne: [] }
                    }
                },

                // Stage 2: Project and filter tasks in one go
                {
                    $project: {
                        email: 1,
                        cookieJar: 1,
                        accountId: '$_id',
                        assignedWorkerId: 1,
                        jobStatus: 1,
                        proxy: 1,
                        currentTask: 1,
                        tasks: {
                            $filter: {
                                input: '$dailyPlan.tasks',
                                as: 'task',
                                cond: {
                                    $and: [
                                        { $eq: ['$$task.status', 'PENDING'] },
                                        { $lte: ['$$task.executeAt', now] }
                                    ]
                                }
                            }
                        }
                    }
                },

                // Stage 3: Only keep accounts that have pending tasks
                {
                    $match: {
                        tasks: { $ne: [] }
                    }
                },

                // Stage 4: Sort tasks within each account
                {
                    $addFields: {
                        tasks: {
                            $sortArray: {
                                input: '$tasks',
                                sortBy: { executeAt: 1 }
                            }
                        }
                    }
                }
            ];

            try {
                const results = await RewardsAccountModel.aggregate(pipeline);

                console.log(`Found ${results.length} accounts with pending tasks`);

                return results;


            } catch (error) {
                console.error('Error fetching accounts with tasks:', error);
                throw error;
            }
        }


    } catch (error) {

    } finally {

    }
    // try {
    //     const now = new Date();
    //     const todayDateString = getTodayDateString();

    //     // Find and claim an eligible job
    //     const assignedJob = await claimEligibleJob(now, todayDateString);

    //     if (!assignedJob) {
    //         console.log('→ No eligible jobs found');
    //         return;
    //     }

    //     console.log(`✓ Claimed job: ${assignedJob._id}`);

    //     // Check if daily plan needs to be created
    //     const needsNewPlan = !assignedJob.dailyPlan || 
    //                         assignedJob.dailyPlan.planDate !== todayDateString;

    //     if (needsNewPlan) {
    //         await processDailyPlanCreation(assignedJob, todayDateString);

    //         // Reload job to get updated daily plan
    //         const updatedJob = await RewardsAccountModel.findById(assignedJob._id);
    //         await processPendingTasks(updatedJob, now, todayDateString);
    //     } else {
    //         await processPendingTasks(assignedJob, now, todayDateString);
    //     }

    // } catch (error) {
    //     console.error('✗ Error during scheduled task:', error.message);
    //     console.error(error.stack);
    // } finally {
    //     isTaskRunning = false;
    //     const endTime = new Date();
    //     const duration = ((endTime - startTime) / 1000).toFixed(2);
    //     console.log(`${'='.repeat(60)}`);
    //     console.log(`✓ Task completed at ${endTime.toLocaleTimeString()} (${duration}s)`);
    //     console.log(`${'='.repeat(60)}\n`);
    // }
}

// ============================================
// APPLICATION STARTUP
// ============================================

/**
 * Main application entry point
 * Connects to database and starts cron scheduler
 */
async function startApplication() {
    console.log('🚀 Starting Cron Job Manager...\n');

    await connectToDatabase();

    // Uncomment to test persona generation
    // const testPersona = await generatePersona();
    // await savePersona(testPersona);

    // Start cron scheduler
    cron.schedule(CONFIG.CRON_SCHEDULE, performScheduledTask);

    console.log(`✓ Cron job scheduled: ${CONFIG.CRON_SCHEDULE}`);
    console.log('✓ Application ready and waiting for scheduled tasks...\n');
}

// ============================================
// RUN APPLICATION
// ============================================

startApplication().catch(error => {
    console.error('✗ Fatal error during startup:', error.message);
    process.exit(1);
});