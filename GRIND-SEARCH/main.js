require('dotenv').config();
const connectDB = require('./config/db');
const runPlanner = require('./jobs/planner');
const runExecutor = require('./jobs/executor');

const main = async () => {
    await connectDB();

    console.log(`Scheduler started. Timezone is set to: ${process.env.TIMEZONE}`);

    // --- Executor: Runs every minute ---
    console.log('Starting Executor job to run every 60 seconds.');
    runExecutor(); // Run immediately on start
    setInterval(runExecutor, 60 * 1000);

    // --- Planner: Checks every 15 minutes if it's time to run ---
    console.log('Starting Planner job to check every 15 minutes.');
    runPlanner(); // Run immediately on start to check the time window
    setInterval(runPlanner, 15 * 60 * 1000);
};

main();





