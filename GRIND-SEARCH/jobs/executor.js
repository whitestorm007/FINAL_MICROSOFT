const RewardsAccountModel = require('../models/rewardsAccount');
const BingSearch = require('../services/bingSearchService');
const { getNetworkTime } = require('../utils/time');

// const runExecutor = async () => {
//     const nowUtc = await getNetworkTime();
//     let account = null; // To hold the account we are processing

//     try {
//         // --- ATOMIC CLAIM ---
//         // Find an available account with at least one due task and "claim" it
//         // by setting its status to RUNNING in a single, atomic operation.
//         account = await RewardsAccountModel.findOneAndUpdate({
//             isEnabled: true,
//             jobStatus: 'IDLE',
//             'dailyPlan.tasks': {
//                 $elemMatch: {
//                     status: 'PENDING',
//                     // executeAt: { $lte: nowUtc }
//                 }
//             }
//         }, {
//             $set: { jobStatus: 'RUNNING' }
//         });

//         // If no account was found, it means there's nothing to do. Exit gracefully.
//         if (!account) {
//             console.log("NO ACCOUNT FOUND");
//             return;
//         }

//         console.log(`[Executor] Claimed account ${account.email} for processing.`);

//         // Find the single, next task to run for this account.
//         const taskToRun = account.dailyPlan.tasks
//             .filter(task => task.status === 'PENDING')
//             // .filter(task => task.status === 'PENDING' && task.executeAt <= nowUtc)
//             .sort((a, b) => a.executeAt - b.executeAt)[0]; // Get the oldest due task

//         if (!taskToRun) {
//             console.warn(`[Executor] Account ${account.email} was claimed, but no due task was found. Releasing.`);
//             return; // The finally block will release the account
//         }

//         console.log(`[Executor] Processing task for ${account.email}: ${taskToRun.query || 'DAILY_GRIND'}`);

//         const searchJob = new BingSearch(taskToRun, account.email, account.cookieJar);

//         // Mark task as RUNNING in the DB to prevent re-execution
//         await RewardsAccountModel.updateOne(
//             { 'dailyPlan.tasks._id': taskToRun._id },
//             { $set: { 'dailyPlan.tasks.$.status': 'RUNNING' } }
//         );

//         const result = await searchJob.execute();

//         // Persist the updated cookie jar after the single task
//         // await RewardsAccountModel.updateOne(
//         //     { _id: account._id },
//         //     { $set: { cookieJar: result.updatedCookieJar } }
//         // );

//         // Mark task as COMPLETE or FAILED
//         const finalStatus = result.success ? 'COMPLETE' : 'FAILED';
//         await RewardsAccountModel.updateOne(
//             { 'dailyPlan.tasks._id': taskToRun._id },
//             { $set: { 'dailyPlan.tasks.$.status': finalStatus } }
//         );

//     } catch (error) {
//         if (account) {
//             console.error(`[Executor] Failed to execute task for ${account.email}:`, error);
//         } else {
//             console.error('[Executor] A critical error occurred:', error);
//         }
//     } finally {
//         // --- RELEASE THE LOCK ---
//         // CRITICAL: Always set the jobStatus back to IDLE, even if an error occurred.
//         // This prevents the account from being permanently stuck in a 'RUNNING' state.
//         if (account) {
//             await RewardsAccountModel.updateOne(
//                 { _id: account._id },
//                 { $set: { jobStatus: 'IDLE' } }
//             );
//             console.log(`[Executor] Released account ${account.email}.`);
//         }
//     }
// };
const runExecutor = async () => {
    const MAX_CONCURRENT_ACCOUNTS = 20;
    const nowUtc = await getNetworkTime();

    try {
        // --- ATOMIC BULK CLAIM WITH AGGREGATION ---
        // Get IDs of up to 20 accounts that need processing
        const accountsToClaim = await RewardsAccountModel.aggregate([
            {
                $match: {
                    isEnabled: true,
                    jobStatus: 'IDLE',
                    'dailyPlan.tasks': {
                        $elemMatch: {
                            status: 'PENDING',
                            // executeAt: { $lte: nowUtc }
                        }
                    }
                }
            },
            { $limit: MAX_CONCURRENT_ACCOUNTS },
            { $project: { _id: 1 } }
        ]);

        if (accountsToClaim.length === 0) {
            console.log("NO ACCOUNTS FOUND");
            return;
        }

        const accountIds = accountsToClaim.map(a => a._id);

        // Bulk update all selected accounts to RUNNING status
        const bulkUpdateResult = await RewardsAccountModel.updateMany(
            { _id: { $in: accountIds } },
            { $set: { jobStatus: 'RUNNING' } }
        );

        console.log(`[Executor] Claimed ${bulkUpdateResult.modifiedCount} accounts for processing.`);

        // Fetch the full account documents
        const accounts = await RewardsAccountModel.find({ _id: { $in: accountIds } });

        // Process all accounts concurrently
        const processingPromises = accounts.map(account => processAccount(account, nowUtc));
        const results = await Promise.allSettled(processingPromises);

        // Log results summary
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        console.log(`[Executor] Processing complete. Success: ${successful}, Failed: ${failed}`);

        // Release all accounts back to IDLE
        await RewardsAccountModel.updateMany(
            { _id: { $in: accountIds } },
            { $set: { jobStatus: 'IDLE' } }
        );

        console.log(`[Executor] Released ${accounts.length} accounts.`);

    } catch (error) {
        console.error('[Executor] A critical error occurred during bulk processing:', error);
    }
};
// Separate function to process a single account
const processAccount = async (account, nowUtc) => {
    try {
        console.log(`[Executor] Processing account ${account.email}`);

        // Find the single, next task to run for this account
        const taskToRun = account.dailyPlan.tasks
            .filter(task => task.status === 'PENDING')
            // .filter(task => task.status === 'PENDING' && task.executeAt <= nowUtc)
            .sort((a, b) => a.executeAt - b.executeAt)[0]; // Get the oldest due task

        if (!taskToRun) {
            console.warn(`[Executor] Account ${account.email} was claimed, but no due task was found.`);
            return { account: account.email, success: false, reason: 'No due tasks' };
        }

        console.log(`[Executor] Processing task for ${account.email}: ${taskToRun.query || 'DAILY_GRIND'}`);

        const searchJob = new BingSearch(taskToRun, account.email, account.cookieJar);

        // Mark task as RUNNING in the DB to prevent re-execution
        await RewardsAccountModel.updateOne(
            { 'dailyPlan.tasks._id': taskToRun._id },
            { $set: { 'dailyPlan.tasks.$.status': 'RUNNING' } }
        );

        const result = await searchJob.execute();

        // Persist the updated cookie jar after the single task (uncomment if needed)
        // await RewardsAccountModel.updateOne(
        //     { _id: account._id },
        //     { $set: { cookieJar: result.updatedCookieJar } }
        // );

        // Mark task as COMPLETE or FAILED
        const finalStatus = result.success ? 'COMPLETE' : 'FAILED';
        await RewardsAccountModel.updateOne(
            { 'dailyPlan.tasks._id': taskToRun._id },
            { $set: { 'dailyPlan.tasks.$.status': finalStatus } }
        );

        console.log(`[Executor] Successfully processed task for ${account.email}`);
        return { account: account.email, success: true, taskId: taskToRun._id };

    } catch (error) {
        console.error(`[Executor] Failed to execute task for ${account.email}:`, error);

        // Try to mark the task as FAILED if we have the taskId
        // This is a best-effort attempt, don't throw if it fails
        try {
            const taskToRun = account.dailyPlan.tasks
                .filter(task => task.status === 'RUNNING')[0];

            if (taskToRun) {
                await RewardsAccountModel.updateOne(
                    { 'dailyPlan.tasks._id': taskToRun._id },
                    { $set: { 'dailyPlan.tasks.$.status': 'FAILED' } }
                );
            }
        } catch (updateError) {
            console.error(`[Executor] Failed to update task status for ${account.email}:`, updateError);
        }

        throw error; // Re-throw to be caught by Promise.allSettled
    }
};
module.exports = runExecutor;

