const { format } = require('date-fns-tz');
const { getNetworkTime } = require('../utils/time');
const RewardsAccountModel = require('../models/rewardsAccount');
const PersonaModel = require('../models/persona');
const AIPlannerService = require('../services/aiPlannerService');

/**
 * Phase 1: Finds enabled accounts without a persona and assigns one from the available pool.
 */
const assignPersonasToNewAccounts = async () => {
    console.log('[Planner - Phase 1] Checking for accounts that need a persona...');

    try {
        const accountsNeedingPersona = await RewardsAccountModel.find({
            isEnabled: true,
            persona: null
        });

        if (accountsNeedingPersona.length === 0) {
            console.log('[Planner - Phase 1] No accounts are currently awaiting persona assignment.');
            return;
        }

        console.log(`[Planner - Phase 1] Found ${accountsNeedingPersona.length} accounts to process.`);

        for (const account of accountsNeedingPersona) {
            const assignedPersona = await PersonaModel.findOneAndUpdate(
                { isAssigned: false },
                { $set: { isAssigned: true } },
                { new: true }
            );

            if (assignedPersona) {
                account.persona = assignedPersona._id;
                await account.save();
                console.log(`[Planner - Phase 1] Successfully assigned Persona "${assignedPersona.name}" to Account "${account.email}".`);
            } else {
                console.warn(`[Planner - Phase 1] No available personas in the pool to assign to Account "${account.email}".`);
                break;
            }
        }
    } catch (error) {
        console.error('[Planner - Phase 1] Error during persona assignment:', error);
    }
};

/**
 * Phase 2: Finds accounts that need a plan for today and generates one.
 */
const generatePlansForAccounts = async (todayDateStr) => {
    console.log(`[Planner - Phase 2] Checking for accounts that need a plan for ${todayDateStr}...`);
    try {
        const accountsToPlan = await RewardsAccountModel.find({
            isEnabled: true,
            $or: [
                { 'dailyPlan.planDate': { $ne: todayDateStr } },
                { 'dailyPlan': { $exists: false } }
            ]
        });

        if (accountsToPlan.length === 0) {
            console.log('[Planner - Phase 2] All active accounts are already planned for today.');
            return;
        }
        
        console.log(`[Planner - Phase 2] Found ${accountsToPlan.length} accounts needing a daily plan.`);

        for (const account of accountsToPlan) {
            console.log(`[Planner - Phase 2] Generating a unique plan for ${account.email}...`);
            
            // --- THIS IS THE FIX ---
            // We now correctly pass the date string to the AI planner service.
            const newTasks = await AIPlannerService.generateDailyPlan(todayDateStr);

            if (!newTasks || newTasks.length === 0) {
                console.error(`[Planner - Phase 2] Failed to generate a task list for ${account.email}. Skipping.`);
                continue;
            }

            account.dailyPlan = {
                planDate: todayDateStr,
                tasks: newTasks
            };
            account.searchProgress = { pc: 0, mobile: 0 };
            account.jobStatus = 'IDLE';

            await account.save();
            console.log(`[Planner - Phase 2] Successfully assigned new plan with ${newTasks.length} tasks to ${account.email}.`);
        }

    } catch (error) {
        console.error('[Planner - Phase 2] An error occurred during plan generation:', error);
    }
};

/**
 * Main planner function that orchestrates the assignment and planning phases.
 */
const runPlanner = async () => {
    const timeZone = process.env.TIMEZONE;
    if (!timeZone) {
        console.error("TIMEZONE is not set in the .env file.");
        return;
    }

    const accurateTime = await getNetworkTime(); 
    const currentHour = parseInt(format(accurateTime, 'H', { timeZone }));

    // Test window for development
    // if (currentHour >= 6 && currentHour < 13) {  // Will run when it's 10 AM in New York
        console.log(`[Planner] Running within the allowed window (Hour: ${currentHour} in ${timeZone}).`);
        
        const todayDateStr = format(accurateTime, 'yyyy-MM-dd', { timeZone });

        await assignPersonasToNewAccounts();
        await generatePlansForAccounts(todayDateStr);

        console.log('[Planner] Planner job finished.');
    // } else {
    //     console.log(`[Planner] Not in the 10:00-11:00 window for ${timeZone}. Current hour: ${currentHour}. Skipping.`);
    //     return;
    // }
};

module.exports = runPlanner;



