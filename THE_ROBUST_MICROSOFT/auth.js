require('dotenv').config();
const mongoose = require('mongoose');
const RewardsAccountModel = require('./model/db');
const { MicrosoftAuth, AuthState } = require('./microsoft-auth');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Process interval in milliseconds (5 minutes)
    PROCESS_INTERVAL: 5000,

    // Maximum accounts to process per cycle
    MAX_ACCOUNTS_PER_CYCLE: 1,

    // Delay between processing individual accounts (to avoid rate limiting)
    ACCOUNT_DELAY: 10 * 1000, // 10 seconds

    // MongoDB connection string from .env
    MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/microsoft-accounts',

    // Worker ID (for distributed processing)
    WORKER_ID: process.env.WORKER_ID || `worker-${process.pid}`,

    // Days before ALT email is required
    ALT_REQUIRED_DAYS: 7
};

// ============================================================================
// DATABASE CONNECTION
// ============================================================================

class DatabaseManager {
    static async connect() {
        try {
            console.log(CONFIG.MONGO_URI);
            await mongoose.connect(CONFIG.MONGO_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true
            });
            console.log(`[DB] Connected to MongoDB`);
            return true;
        } catch (error) {
            console.error(`[DB] Connection failed:`, error.message);
            return false;
        }
    }

    static async disconnect() {
        await mongoose.disconnect();
        console.log(`[DB] Disconnected from MongoDB`);
    }
}

// ============================================================================
// ACCOUNT PROCESSOR
// ============================================================================

class AccountProcessor {
    constructor() {
        this.isRunning = false;
        this.processedCount = 0;
        this.errorCount = 0;
    }

    /**
     * Convert cookieJar to string format
     * MongoDB sometimes returns it as object instead of string
     */
    _normalizeCookieJar(cookieJar) {
        if (!cookieJar) return null;

        try {
            if (typeof cookieJar === 'string') {
                // If it's already a string, verify it's valid JSON
                JSON.parse(cookieJar);
                return cookieJar;
            } else if (typeof cookieJar === 'object') {
                // If it's an object, stringify it
                return JSON.stringify(cookieJar);
            }
        } catch (error) {
            console.error('Error normalizing cookieJar:', error.message);
            return null;
        }

        return null;
    }

    /**
     * Find accounts that need attention
     */
    async findBadAccounts(limit = CONFIG.MAX_ACCOUNTS_PER_CYCLE) {
        const now = new Date();
        const altDeadline = new Date(now - CONFIG.ALT_REQUIRED_DAYS * 24 * 60 * 60 * 1000);

        const query = {
            isEnabled: true,
            accountStatus: { $in: ['ACTIVE', 'MANUAL_REVIEW'] },
            jobStatus: 'IDLE',
            $or: [
                // Missing cookie jar
                { cookieJar: { $in: [null, ''] } },

                // Missing recovery account but account is old enough to need one
                {
                    'recoveryAccount.set': { $ne: true },
                },

                // Has auth errors that need attention
                {
                    currentTask: { $in: ['RE_AUTH', 'AUTH_FULL'] },
                    currentTaskError: { $ne: 'None' }
                },


            ]
        };

        return await RewardsAccountModel.find(query)
            .limit(limit)
            .sort({ nextSessionEligible: 1 })
            .exec();
    }

    /**
     * Determine what action is needed for an account
     */
    async analyzeAccount(account) {
        const issues = [];

        // Check for missing cookie jar
        if (!account.cookieJar || account.cookieJar === '') {
            issues.push({
                type: 'MISSING_COOKIES',
                action: 'FULL_LOGIN',
                priority: 1
            });
        }

        // Check for missing ALT email
        if (!account.recoveryAccount?.set) {
            issues.push({
                type: 'MISSING_ALT',
                action: 'ADD_ALT',
                priority: 2
            });
        }

        // Check for auth errors
        if (account.currentTaskError && account.currentTaskError !== 'None') {
            issues.push({
                type: 'AUTH_ERROR',
                action: 'RE_AUTH',
                priority: 3,
                error: account.currentTaskError
            });
        }

        // Check for expired session


        // Sort by priority
        issues.sort((a, b) => a.priority - b.priority);

        return issues;
    }

    /**
     * Process a single account
     * Solves all issues by priority, with 2 retry attempts per issue
     */
    async processAccount(account) {
        const logPrefix = `[${account.email}]`;
        const MAX_RETRIES_PER_ISSUE = 2;
        const processedIssues = [];
        const failedIssues = [];
        let totalSuccessCount = 0;

        try {
            console.log(`${logPrefix} Starting processing...`);

            // Mark account as running
            await RewardsAccountModel.updateOne(
                { _id: account._id },
                {
                    jobStatus: 'RUNNING',
                    assignedWorkerId: CONFIG.WORKER_ID,
                    jobMessage: 'Processing authentication issues'
                }
            );

            // Re-fetch account to get latest state after each fix
            let currentAccount = account;

            // Keep processing until no more issues or max iterations reached
            const MAX_ITERATIONS = 5; // Prevent infinite loops
            let iteration = 0;

            while (iteration < MAX_ITERATIONS) {
                iteration++;

                // Re-analyze account for current issues
                const issues = await this.analyzeAccount(currentAccount);

                if (issues.length === 0) {
                    console.log(`${logPrefix} ✅ All issues resolved!`);
                    await this.markAccountSuccess(currentAccount, {
                        message: `Successfully resolved ${totalSuccessCount} issue(s)`,
                        processedIssues: processedIssues
                    });
                    this.processedCount++;
                    return {
                        success: true,
                        message: `All issues resolved (${totalSuccessCount} fixed)`,
                        processedIssues,
                        failedIssues
                    };
                }

                console.log(`${logPrefix} [Iteration ${iteration}] Found ${issues.length} issue(s):`,
                    issues.map(i => i.type).join(', '));

                // Get the highest priority issue
                const currentIssue = issues[0];
                const issueKey = currentIssue.type;

                console.log(`${logPrefix} 🔧 Processing issue: ${currentIssue.type} (Priority: ${currentIssue.priority})`);

                // Try to solve this issue with retries
                let issueResolved = false;
                let lastError = null;

                for (let attempt = 1; attempt <= MAX_RETRIES_PER_ISSUE; attempt++) {
                    console.log(`${logPrefix}   Attempt ${attempt}/${MAX_RETRIES_PER_ISSUE} for ${currentIssue.type}...`);

                    const result = await this.handleIssue(currentAccount, currentIssue);

                    if (result.success) {
                        console.log(`${logPrefix}   ✅ ${currentIssue.type} resolved on attempt ${attempt}`);
                        processedIssues.push({
                            type: currentIssue.type,
                            action: currentIssue.action,
                            attempt: attempt,
                            success: true
                        });
                        issueResolved = true;
                        totalSuccessCount++;
                        break;
                    } else {
                        console.log(`${logPrefix}   ❌ ${currentIssue.type} failed on attempt ${attempt}: ${result.error}`);
                        lastError = result.error;

                        // Wait a bit before retry
                        if (attempt < MAX_RETRIES_PER_ISSUE) {
                            await this.sleep(2000); // 2 second delay between retries
                        }
                    }
                }

                // If issue not resolved after retries, log it and move on
                if (!issueResolved) {
                    console.log(`${logPrefix}   ⚠️ ${currentIssue.type} failed after ${MAX_RETRIES_PER_ISSUE} attempts, skipping...`);
                    failedIssues.push({
                        type: currentIssue.type,
                        action: currentIssue.action,
                        error: lastError,
                        attempts: MAX_RETRIES_PER_ISSUE
                    });

                    // If this is a critical issue (MISSING_COOKIES), mark for manual review
                    if (currentIssue.type === 'MISSING_COOKIES' || currentIssue.type === 'AUTH_ERROR') {
                        console.log(`${logPrefix} 🔴 Critical issue failed, marking for manual review`);
                        await this.markAccountForManualReview(currentAccount, {
                            error: `Failed to resolve critical issue: ${currentIssue.type}`,
                            failedIssues: failedIssues,
                            processedIssues: processedIssues
                        });
                        this.errorCount++;
                        return {
                            success: false,
                            message: `Critical issue failed after ${MAX_RETRIES_PER_ISSUE} attempts`,
                            failedIssues,
                            processedIssues
                        };
                    }

                    // For non-critical issues, continue to next issue
                    // Break the loop to re-analyze (the failed issue might have lower priority now)
                }

                // Re-fetch account from database to get updated state
                currentAccount = await RewardsAccountModel.findById(currentAccount._id);

                // Small delay before next iteration
                await this.sleep(1000);
            }

            // If we hit max iterations
            console.log(`${logPrefix} ⚠️ Max iterations reached, marking for manual review`);
            await this.markAccountForManualReview(currentAccount, {
                error: 'Max iterations reached',
                failedIssues: failedIssues,
                processedIssues: processedIssues
            });
            this.errorCount++;

            return {
                success: false,
                message: `Partial success: ${totalSuccessCount} issues resolved, but max iterations reached`,
                processedIssues,
                failedIssues
            };

        } catch (error) {
            console.error(`${logPrefix} Error processing account:`, error.message);
            await this.markAccountFailed(account, {
                success: false,
                error: error.message,
                type: 'PROCESSING_ERROR'
            });
            this.errorCount++;
            return {
                success: false,
                error: error.message,
                processedIssues,
                failedIssues
            };
        }
    }

    /**
     * Handle a specific issue
     */
    async handleIssue(account, issue) {
        const logPrefix = `[${account.email}]`;

        // Prepare auth options with normalized cookieJar
        const authOptions = {
            cookieJar: this._normalizeCookieJar(account.cookieJar),

            recoveryAccount: account.recoveryAccount || null
        };

        const auth = new MicrosoftAuth(
            { email: account.email, password: account.password },
            authOptions
        );

        console.log(auth);
        switch (issue.action) {
            case 'FULL_LOGIN':
                console.log(`${logPrefix} Performing full login...`);
                return await this.performFullLogin(auth, account);

            case 'ADD_ALT':
                console.log(`${logPrefix} Adding alternative email...`);
                return await this.addAlternativeEmail(auth, account);

            case 'RE_AUTH':
                console.log(`${logPrefix} Re-authenticating...`);
                return await this.performReAuth(auth, account);

            case 'REFRESH_SESSION':
                console.log(`${logPrefix} Refreshing session...`);
                return await this.refreshSession(auth, account);

            default:
                return { success: false, error: `Unknown action: ${issue.action}` };
        }
    }

    /**
     * Perform full login
     */
    async performFullLogin(auth, account) {
        try {

            console.log(auth);
            const result = await auth.login(['ALL', 'BING', 'REWARDS', 'OUTLOOK']);

            console.log(result);
            if (result.success) {
                // Update account with new cookies
                await RewardsAccountModel.updateOne(
                    { _id: account._id },
                    {
                        cookieJar: result.cookieJar,
                        currentTask: 'NONE',
                        currentTaskError: 'None',
                        lastSession: new Date(),
                        nextSessionEligible: new Date(Date.now() + 24 * 60 * 60 * 1000) // Next day
                    }
                );

                return {
                    success: true,
                    type: 'FULL_LOGIN',
                    message: 'Login successful',
                    cookies: result.cookies
                };
            } else {
                return {
                    success: false,
                    type: 'FULL_LOGIN',
                    error: result.error || result.message,
                    state: result.state
                };
            }
        } catch (error) {
            console.log(error);
            return {
                success: false,
                type: 'FULL_LOGIN',
                error: error.message
            };
        }
    }

    /**
     * Add alternative email
     */
    async addAlternativeEmail(auth, account) {
        const logPrefix = `[${account.email}]`;

        try {
            // Step 1: Check if recovery account is configured
            if (!account.recoveryAccount || !account.recoveryAccount.email) {
                return {
                    success: false,
                    type: 'ADD_ALT',
                    error: 'Recovery account email not configured in database'
                };
            }

            console.log(`${logPrefix} Recovery account: ${account.recoveryAccount.email}`);

            // Step 2: Find the recovery account in the database
            const recoveryAccount = await RewardsAccountModel.findOne({
                email: account.recoveryAccount.email
            });

            if (!recoveryAccount) {
                return {
                    success: false,
                    type: 'ADD_ALT',
                    error: `Recovery account ${account.recoveryAccount.email} not found in database`
                };
            }

            // Step 3: Authenticate the recovery account to get its session
            console.log(`${logPrefix} Authenticating recovery account...`);

            // Normalize recovery account cookieJar
            const recoveryCookieJarString = this._normalizeCookieJar(recoveryAccount.cookieJar);

            const recoveryAuth = new MicrosoftAuth(
                {
                    email: recoveryAccount.email,
                    password: recoveryAccount.password
                },
                {
                    cookieJar: recoveryCookieJarString,

                }
            );

            // Try to verify existing session first
            let recoverySessionValid = false;
            if (recoveryCookieJarString) {
                const verifyResult = await recoveryAuth.verifySession();
                recoverySessionValid = verifyResult.success;
            }

            // If session invalid or doesn't exist, authenticate
            if (!recoverySessionValid) {
                console.log(`${logPrefix} Recovery account session invalid, logging in...`);
                const recoveryResult = await recoveryAuth.login(['ALL', "REWARDS", "BING", 'OUTLOOK']);

                if (!recoveryResult.success) {
                    return {
                        success: false,
                        type: 'ADD_ALT',
                        error: `Failed to authenticate recovery account: ${recoveryResult.error}`,
                        state: recoveryResult.state
                    };
                }

                // Update recovery account's cookie jar in database
                await RewardsAccountModel.updateOne(
                    { _id: recoveryAccount._id },
                    {
                        cookieJar: recoveryResult.cookieJar,
                        lastSession: new Date()
                    }
                );

                console.log(`${logPrefix} Recovery account authenticated successfully`);
            } else {
                console.log(`${logPrefix} Using existing recovery account session`);
            }

            // Step 4: Create new auth instance with recovery account session
            console.log(`${logPrefix} Authenticating main account with recovery session...`);

            // Normalize main account cookieJar
            const mainCookieJarString = this._normalizeCookieJar(account.cookieJar);

            const mainAuth = new MicrosoftAuth(
                {
                    email: account.email,
                    password: account.password
                },
                {
                    cookieJar: mainCookieJarString,
                    recoveryAccount: {
                        Add: true,
                        email: recoveryAccount.email,
                        password: recoveryAccount.password,
                        session: recoveryAuth.session  // Pass authenticated session for auto-OTP
                    }
                }
            );

            // Step 5: Perform login which will add the ALT email
            console.log(`${logPrefix} Logging in to add ALT email...`);
            const mainResult = await mainAuth.login(['ALL']);
            console.log(await mainAuth._DoForceAlt());
            console.log(`${logPrefix} Login result:`, mainResult.success ? 'SUCCESS' : 'FAILED')

            if (mainResult.success) {
                // Update account with new cookies and mark ALT as set
                await RewardsAccountModel.updateOne(
                    { _id: account._id },
                    {
                        'recoveryAccount.set': true,
                        cookieJar: mainResult.cookieJar,
                        currentTask: 'NONE',
                        currentTaskError: 'None',
                        lastSession: new Date()
                    }
                );

                console.log(`${logPrefix} Alternative email added successfully`);

                return {
                    success: true,
                    type: 'ADD_ALT',
                    message: 'Alternative email added successfully'
                };
            } else {
                return {
                    success: false,
                    type: 'ADD_ALT',
                    error: mainResult.error || 'Failed to add alternative email',
                    state: mainResult.state
                };
            }

        } catch (error) {
            console.log(error);
            console.error(`${logPrefix} Error adding ALT:`, error.message);
            return {
                success: false,
                type: 'ADD_ALT',
                error: error.message
            };
        }
    }

    /**
     * Re-authenticate account
     */
    async performReAuth(auth, account) {
        try {
            const result = await auth.login(['ALL', 'BING', 'REWARDS', 'OUTLOOK']);

            if (result.success) {
                await RewardsAccountModel.updateOne(
                    { _id: account._id },
                    {
                        cookieJar: result.cookieJar,
                        currentTask: 'NONE',
                        currentTaskError: 'None',
                        lastSession: new Date(),
                        nextSessionEligible: new Date(Date.now() + 24 * 60 * 60 * 1000)
                    }
                );

                return {
                    success: true,
                    type: 'RE_AUTH',
                    message: 'Re-authentication successful'
                };
            } else {
                // Handle specific auth states
                if (result.state === AuthState.ACCOUNT_LOCKED) {
                    await RewardsAccountModel.updateOne(
                        { _id: account._id },
                        { accountStatus: 'LOCKED' }
                    );
                } else if (result.state === AuthState.NEED_TO_ADD_ALT) {
                    await RewardsAccountModel.updateOne(
                        { _id: account._id },
                        { currentTask: 'ALT' }
                    );
                }

                return {
                    success: false,
                    type: 'RE_AUTH',
                    error: result.error,
                    state: result.state
                };
            }
        } catch (error) {
            return {
                success: false,
                type: 'RE_AUTH',
                error: error.message
            };
        }
    }

    /**
     * Refresh existing session
     */
    async refreshSession(auth, account) {
        try {
            // Verify if session is still valid
            const verifyResult = await auth.verifySession();

            if (verifyResult.success) {
                await RewardsAccountModel.updateOne(
                    { _id: account._id },
                    {
                        lastSession: new Date(),
                        nextSessionEligible: new Date(Date.now() + 24 * 60 * 60 * 1000),
                        currentTask: 'NONE',
                        currentTaskError: 'None'
                    }
                );

                return {
                    success: true,
                    type: 'REFRESH_SESSION',
                    message: 'Session still valid'
                };
            } else {
                // Session invalid, perform full login
                return await this.performFullLogin(auth, account);
            }
        } catch (error) {
            return {
                success: false,
                type: 'REFRESH_SESSION',
                error: error.message
            };
        }
    }

    /**
     * Mark account as successfully processed
     */
    async markAccountSuccess(account, result) {
        await RewardsAccountModel.updateOne(
            { _id: account._id },
            {
                jobStatus: 'IDLE',
                jobMessage: result.message || 'Processing completed successfully',
                assignedWorkerId: null,
                lastSession: new Date()
            }
        );
    }

    /**
     * Mark account as failed
     */
    async markAccountFailed(account, result) {
        const updates = {
            jobStatus: 'IDLE',
            jobMessage: result.error || 'Processing failed',
            currentTaskError: result.error || 'Unknown error',
            assignedWorkerId: null
        };

        // Handle specific error states
        if (result.state === AuthState.ACCOUNT_LOCKED) {
            updates.accountStatus = 'LOCKED';
        } else if (result.state === AuthState.NEED_TO_ADD_ALT) {
            updates.currentTask = 'ALT';
        } else if (result.state === AuthState.INVALID_CREDENTIALS) {
            updates.accountStatus = 'SUSPENDED';
        } else if (result.state === AuthState.REAUTH_NEEDED) {
            updates.currentTask = 'RE_AUTH';
        }

        await RewardsAccountModel.updateOne({ _id: account._id }, updates);
    }

    /**
     * Mark account for manual review
     */
    async markAccountForManualReview(account, result) {
        const updates = {
            jobStatus: 'IDLE',
            accountStatus: 'MANUAL_REVIEW',
            jobMessage: `Manual review needed: ${result.error || 'Multiple issues failed'}`,
            currentTaskError: result.error || 'Unknown error',
            assignedWorkerId: null
        };

        // Store details about what was processed and what failed
        if (result.processedIssues && result.processedIssues.length > 0) {
            updates.lastProcessingAttempt = {
                timestamp: new Date(),
                processedIssues: result.processedIssues,
                failedIssues: result.failedIssues || [],
                workerId: CONFIG.WORKER_ID
            };
        }

        await RewardsAccountModel.updateOne({ _id: account._id }, updates);
        console.log(`[${account.email}] Marked for manual review`);
    }

    /**
     * Mark account as idle (no action needed)
     */
    async markAccountIdle(account, message) {
        await RewardsAccountModel.updateOne(
            { _id: account._id },
            {
                jobStatus: 'IDLE',
                jobMessage: message,
                assignedWorkerId: null,
                nextSessionEligible: new Date(Date.now() + 24 * 60 * 60 * 1000)
            }
        );
    }

    /**
     * Process all bad accounts
     */
    async processBatch() {
        console.log(`\n[Worker] Starting new processing cycle...`);

        const accounts = await this.findBadAccounts();
        console.log({ accounts });
        console.log(`[Worker] Found ${accounts.length} account(s) needing attention`);

        if (accounts.length === 0) {
            return;
        }

        for (const account of accounts) {
            await this.processAccount(account);

            // Delay between accounts to avoid rate limiting
            if (CONFIG.ACCOUNT_DELAY > 0) {
                await this.sleep(CONFIG.ACCOUNT_DELAY);
            }
        }

        console.log(`[Worker] Cycle complete. Processed: ${this.processedCount}, Errors: ${this.errorCount}`);
    }

    /**
     * Start continuous processing
     */
    async start() {
        if (this.isRunning) {
            console.log('[Worker] Already running');
            return;
        }

        console.log(`[Worker] Starting auth worker (ID: ${CONFIG.WORKER_ID})`);
        this.isRunning = true;

        while (this.isRunning) {
            try {
                await this.processBatch();
            } catch (error) {
                console.error('[Worker] Error in processing cycle:', error.message);
            }

            // Wait before next cycle
            console.log(`[Worker] Waiting ${CONFIG.PROCESS_INTERVAL / 1000}s until next cycle...`);
            await this.sleep(CONFIG.PROCESS_INTERVAL);
        }
    }

    /**
     * Stop the worker
     */
    stop() {
        console.log('[Worker] Stopping...');
        this.isRunning = false;
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
    console.log('='.repeat(60));
    console.log('Microsoft Auth Worker');
    console.log('='.repeat(60));

    // Connect to database
    const connected = await DatabaseManager.connect();
    if (!connected) {
        console.error('[Main] Failed to connect to database, exiting');
        process.exit(1);
    }

    // Create and start processor
    const processor = new AccountProcessor();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n[Main] Received SIGINT, shutting down...');
        processor.stop();
        await DatabaseManager.disconnect();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n[Main] Received SIGTERM, shutting down...');
        processor.stop();
        await DatabaseManager.disconnect();
        process.exit(0);
    });

    // Start processing
    await processor.start();
}

// ============================================================================
// EXPORT & RUN
// ============================================================================

if (require.main === module) {
    main().catch(error => {
        console.error('[Main] Fatal error:', error);
        process.exit(1);
    });
}

module.exports = {
    AccountProcessor,
    DatabaseManager,
    CONFIG
};
