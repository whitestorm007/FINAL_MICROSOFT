require('dotenv').config();
const mongoose = require('mongoose');
const RewardsAccountModel = require('./model/db');
const { AccountProcessor, DatabaseManager, CONFIG } = require('./auth');

// ============================================================================
// DEBUG UTILITIES
// ============================================================================

class AuthDebugger {
    /**
     * Show accounts that would be processed
     */
    static async showBadAccounts() {
        const processor = new AccountProcessor();
        const accounts = await processor.findBadAccounts(100); // Get more for debugging

        console.log('\n=== ACCOUNTS NEEDING ATTENTION ===\n');
        console.log(`Found ${accounts.length} account(s)\n`);

        for (const account of accounts) {
            const issues = await processor.analyzeAccount(account);

            console.log(`Email: ${account.email}`);
            console.log(`  Status: ${account.accountStatus}`);
            console.log(`  Current Task: ${account.currentTask}`);
            console.log(`  Has Cookies: ${account.cookieJar ? 'Yes' : 'No'}`);
            console.log(`  Has ALT: ${account.recoveryAccount?.set ? 'Yes' : 'No'}`);
            console.log(`  Last Error: ${account.currentTaskError}`);
            console.log(`  Issues:`);

            issues.forEach(issue => {
                console.log(`    - ${issue.type} (Priority: ${issue.priority}) -> ${issue.action}`);
            });

            console.log('');
        }
    }

    /**
     * Test processing a single account by email
     */
    static async testSingleAccount(email) {
        const account = await RewardsAccountModel.findOne({ email });

        if (!account) {
            console.log(`Account not found: ${email}`);
            return;
        }

        console.log('\n=== TESTING SINGLE ACCOUNT ===\n');
        console.log(`Email: ${account.email}`);
        console.log(`Status: ${account.accountStatus}`);
        console.log(`Current Task: ${account.currentTask}`);
        console.log('');

        const processor = new AccountProcessor();
        const result = await processor.processAccount(account);

        console.log('\n=== RESULT ===\n');
        console.log(JSON.stringify(result, null, 2));
    }

    /**
     * Show statistics about all accounts
     */
    static async showStatistics() {
        console.log('\n=== ACCOUNT STATISTICS ===\n');

        // Total counts
        const total = await RewardsAccountModel.countDocuments();
        const enabled = await RewardsAccountModel.countDocuments({ isEnabled: true });
        const disabled = await RewardsAccountModel.countDocuments({ isEnabled: false });

        console.log(`Total Accounts: ${total}`);
        console.log(`Enabled: ${enabled}`);
        console.log(`Disabled: ${disabled}`);
        console.log('');

        // Status breakdown
        console.log('Account Status:');
        const statuses = await RewardsAccountModel.aggregate([
            { $group: { _id: '$accountStatus', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        statuses.forEach(s => {
            console.log(`  ${s._id}: ${s.count}`);
        });
        console.log('');

        // Job status
        console.log('Job Status:');
        const jobStatuses = await RewardsAccountModel.aggregate([
            { $group: { _id: '$jobStatus', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        jobStatuses.forEach(s => {
            console.log(`  ${s._id}: ${s.count}`);
        });
        console.log('');

        // Current tasks
        console.log('Current Tasks:');
        const tasks = await RewardsAccountModel.aggregate([
            { $group: { _id: '$currentTask', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        tasks.forEach(t => {
            console.log(`  ${t._id}: ${t.count}`);
        });
        console.log('');

        // Missing cookies
        const noCookies = await RewardsAccountModel.countDocuments({
            $or: [
                { cookieJar: null },
                { cookieJar: '' }
            ],
            isEnabled: true
        });
        console.log(`Missing Cookies: ${noCookies}`);

        // Missing ALT
        const noAlt = await RewardsAccountModel.countDocuments({
            'recoveryAccount.set': { $ne: true },
            isEnabled: true
        });
        console.log(`Missing ALT: ${noAlt}`);

        // Has errors
        const hasErrors = await RewardsAccountModel.countDocuments({
            currentTaskError: { $ne: 'None' },
            isEnabled: true
        });
        console.log(`With Errors: ${hasErrors}`);
        console.log('');
    }

    /**
     * Reset stuck accounts
     */
    static async resetStuckAccounts() {
        console.log('\n=== RESETTING STUCK ACCOUNTS ===\n');

        const result = await RewardsAccountModel.updateMany(
            { jobStatus: 'RUNNING' },
            {
                $set: {
                    jobStatus: 'IDLE',
                    assignedWorkerId: null,
                    jobMessage: 'Reset by debug script'
                }
            }
        );

        console.log(`Reset ${result.modifiedCount} account(s)`);
    }

    /**
     * Show accounts with errors
     */
    static async showErrors() {
        console.log('\n=== ACCOUNTS WITH ERRORS ===\n');

        const accounts = await RewardsAccountModel.find({
            currentTaskError: { $ne: 'None' }
        }).sort({ updatedAt: -1 }).limit(20);

        console.log(`Found ${accounts.length} account(s) with errors\n`);

        accounts.forEach(account => {
            console.log(`Email: ${account.email}`);
            console.log(`  Status: ${account.accountStatus}`);
            console.log(`  Task: ${account.currentTask}`);
            console.log(`  Error: ${account.currentTaskError}`);
            console.log(`  Updated: ${account.updatedAt}`);
            console.log('');
        });
    }

    /**
     * Process one batch (dry run)
     */
    static async dryRunBatch() {
        console.log('\n=== DRY RUN BATCH ===\n');

        const processor = new AccountProcessor();
        const accounts = await processor.findBadAccounts();

        console.log(`Would process ${accounts.length} account(s):`);

        for (const account of accounts) {
            const issues = await processor.analyzeAccount(account);
            const primaryIssue = issues[0];

            console.log(`  - ${account.email}: ${primaryIssue.type} -> ${primaryIssue.action}`);
        }

        console.log('');
    }

    /**
     * Show configuration
     */
    static showConfig() {
        console.log('\n=== CONFIGURATION ===\n');
        console.log(`MONGO_URI: ${CONFIG.MONGO_URI}`);
        console.log(`WORKER_ID: ${CONFIG.WORKER_ID}`);
        console.log(`PROCESS_INTERVAL: ${CONFIG.PROCESS_INTERVAL / 1000}s`);
        console.log(`MAX_ACCOUNTS_PER_CYCLE: ${CONFIG.MAX_ACCOUNTS_PER_CYCLE}`);
        console.log(`ACCOUNT_DELAY: ${CONFIG.ACCOUNT_DELAY / 1000}s`);
        console.log(`ALT_REQUIRED_DAYS: ${CONFIG.ALT_REQUIRED_DAYS}`);
        console.log('');
    }
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

async function main() {
    const command = process.argv[2];
    const arg = process.argv[3];

    // Connect to database
    await DatabaseManager.connect();

    try {
        switch (command) {
            case 'list':
            case 'show':
                await AuthDebugger.showBadAccounts();
                break;

            case 'test':
                if (!arg) {
                    console.log('Usage: node auth-debug.js test <email>');
                    process.exit(1);
                }
                await AuthDebugger.testSingleAccount(arg);
                break;

            case 'stats':
                await AuthDebugger.showStatistics();
                break;

            case 'reset':
                await AuthDebugger.resetStuckAccounts();
                break;

            case 'errors':
                await AuthDebugger.showErrors();
                break;

            case 'dry-run':
                await AuthDebugger.dryRunBatch();
                break;

            case 'config':
                AuthDebugger.showConfig();
                break;

            case 'help':
            default:
                console.log('\n=== AUTH DEBUGGER ===\n');
                console.log('Usage: node auth-debug.js <command> [args]\n');
                console.log('Commands:');
                console.log('  list, show          - Show accounts needing attention');
                console.log('  test <email>        - Test processing a single account');
                console.log('  stats               - Show account statistics');
                console.log('  reset               - Reset stuck accounts');
                console.log('  errors              - Show accounts with errors');
                console.log('  dry-run             - Show what would be processed');
                console.log('  config              - Show current configuration');
                console.log('  help                - Show this help message');
                console.log('');
                console.log('Examples:');
                console.log('  node auth-debug.js list');
                console.log('  node auth-debug.js test user@hotmail.com');
                console.log('  node auth-debug.js stats');
                console.log('');
                break;
        }
    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    } finally {
        await DatabaseManager.disconnect();
    }
}

// ============================================================================
// RUN
// ============================================================================

if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = AuthDebugger;
