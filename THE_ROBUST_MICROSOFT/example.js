const { MicrosoftAuth } = require('./microsoft-auth');
const Accounts = require('./model/db');
const fs = require('fs').promises;

/**
 * Example 1: Simple authentication with automatic OTP
 */
async function simpleAutoOTPAuth() {
    console.log('=== Simple Auto-OTP Authentication ===\n');

    // Step 1: Load or authenticate recovery account
    const recoveryAuth = new MicrosoftAuth(
        { 
            email: 'oixobvys583567@hotmail.com', 
            password: 'qfyteepx6690270' 
        }
    );

    console.log('🔑 Authenticating recovery account...');
    const recoveryResult = await recoveryAuth.login(['OUTLOOK']);
    
    if (!recoveryResult.success) {
        console.error('❌ Recovery account auth failed:', recoveryResult.error);
        return { success: false, error: 'Recovery account authentication failed' };
    }

    console.log('✅ Recovery account ready\n');

    // Step 2: Authenticate main account with automatic OTP
    const mainAuth = new MicrosoftAuth(
        { 
            email: 'dzmcjnmv5259@hotmail.com', 
            password: 'wjqyizuv9542220' 
        },
        {
            recoveryAccount: {
                Add: true,
                email: 'oixobvys583567@hotmail.com',
                password: 'qfyteepx6690270',
                session: recoveryAuth.session // Pass session for auto-OTP
            }
        }
    );

    console.log('🔑 Authenticating main account...');
    const mainResult = await mainAuth.login(['ALL', 'OUTLOOK', 'REWARDS', 'BING']);

    if (mainResult.success) {
        console.log('\n✅ SUCCESS! Main account fully authenticated');
        console.log('📦 Available cookies:', Object.keys(mainResult.cookies));
        
        // Save cookie jar
        await fs.writeFile('./main-account-cookies.json', mainResult.cookieJar);
        console.log('💾 Cookies saved to main-account-cookies.json');
        
        return { success: true, cookies: mainResult.cookies };
    } else {
        console.error('\n❌ FAILED:', mainResult.error);
        return { success: false, error: mainResult.error };
    }
}

/**
 * Example 2: Using saved recovery account session
 */
async function authWithSavedRecoverySession() {
    console.log('=== Authentication with Saved Recovery Session ===\n');

    try {
        // Load saved recovery account cookie jar
        const recoveryCookieJar = await fs.readFile('./recovery-cookies.json', 'utf8');
        
        console.log('📂 Loaded recovery account session from file');

        // Authenticate main account
        const mainAuth = new MicrosoftAuth(
            { 
                email: 'dzmcjnmv5259@hotmail.com', 
                password: 'wjqyizuv9542220' 
            },
            {
                recoveryAccount: {
                    Add: true,
                    email: 'oixobvys583567@hotmail.com',
                    cookieJar: recoveryCookieJar // Use saved session
                }
            }
        );

        console.log('🔑 Authenticating main account...');
        const result = await mainAuth.login(['ALL', 'OUTLOOK']);

        if (result.success) {
            console.log('✅ Authentication successful!');
            return result;
        } else {
            console.error('❌ Authentication failed:', result.error);
            return result;
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Example 3: Batch processing with automatic OTP
 */
async function batchAuthWithAutoOTP() {
    console.log('=== Batch Authentication with Auto-OTP ===\n');

    const accounts = [
        {
            main: { email: 'account1@hotmail.com', password: 'pass1' },
            recovery: { email: 'recovery1@hotmail.com', password: 'recpass1' }
        },
        {
            main: { email: 'account2@hotmail.com', password: 'pass2' },
            recovery: { email: 'recovery2@hotmail.com', password: 'recpass2' }
        }
    ];

    const results = [];

    for (const [index, account] of accounts.entries()) {
        console.log(`\n--- Processing account ${index + 1}/${accounts.length} ---`);
        console.log(`📧 Main: ${account.main.email}`);
        console.log(`🔐 Recovery: ${account.recovery.email}`);

        try {
            // Authenticate recovery account
            const recoveryAuth = new MicrosoftAuth(account.recovery);
            const recoveryResult = await recoveryAuth.login(['OUTLOOK']);

            if (!recoveryResult.success) {
                console.error(`❌ Recovery auth failed for ${account.recovery.email}`);
                results.push({
                    email: account.main.email,
                    success: false,
                    error: 'Recovery account failed'
                });
                continue;
            }

            // Authenticate main account
            const mainAuth = new MicrosoftAuth(
                account.main,
                {
                    recoveryAccount: {
                        Add: true,
                        email: account.recovery.email,
                        session: recoveryAuth.session
                    }
                }
            );

            const mainResult = await mainAuth.login(['ALL', 'OUTLOOK', 'REWARDS']);

            if (mainResult.success) {
                console.log(`✅ ${account.main.email} - SUCCESS`);
                
                // Save to database
                await saveAccountToDatabase({
                    email: account.main.email,
                    cookieJar: mainResult.cookieJar,
                    cookies: mainResult.cookies,
                    lastAuthenticated: new Date()
                });

                results.push({
                    email: account.main.email,
                    success: true,
                    cookies: mainResult.cookies
                });
            } else {
                console.error(`❌ ${account.main.email} - FAILED: ${mainResult.error}`);
                results.push({
                    email: account.main.email,
                    success: false,
                    error: mainResult.error
                });
            }

        } catch (error) {
            console.error(`❌ ${account.main.email} - ERROR: ${error.message}`);
            results.push({
                email: account.main.email,
                success: false,
                error: error.message
            });
        }

        // Wait between accounts to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('\n=== Batch Results ===');
    const successful = results.filter(r => r.success).length;
    console.log(`✅ Success: ${successful}/${results.length}`);
    console.log(`❌ Failed: ${results.length - successful}/${results.length}`);

    return results;
}

/**
 * Example 4: Smart authentication with session reuse
 */
async function smartAuthWithSessionReuse() {
    console.log('=== Smart Authentication with Session Reuse ===\n');

    const mainEmail = 'dzmcjnmv5259@hotmail.com';
    const recoveryEmail = 'oixobvys583567@hotmail.com';

    try {
        // Try to load saved sessions
        let mainCookieJar, recoveryCookieJar;

        try {
            mainCookieJar = await fs.readFile(`./sessions/${mainEmail}.json`, 'utf8');
            console.log('📂 Loaded main account session');
        } catch {
            console.log('ℹ️  No saved main account session');
        }

        try {
            recoveryCookieJar = await fs.readFile(`./sessions/${recoveryEmail}.json`, 'utf8');
            console.log('📂 Loaded recovery account session');
        } catch {
            console.log('ℹ️  No saved recovery account session');
        }

        // Verify main session
        if (mainCookieJar) {
            const mainAuth = new MicrosoftAuth(
                { email: mainEmail, password: 'wjqyizuv9542220' },
                { cookieJar: mainCookieJar }
            );

            const verified = await mainAuth.verifySession();
            if (verified.success) {
                console.log('✅ Main session is still valid!');
                return { success: true, message: 'Using existing session' };
            } else {
                console.log('⚠️  Main session expired, re-authenticating...');
            }
        }

        // Need to authenticate
        let recoveryAuth;

        if (recoveryCookieJar) {
            // Try using saved recovery session
            recoveryAuth = new MicrosoftAuth(
                { email: recoveryEmail, password: 'qfyteepx6690270' },
                { cookieJar: recoveryCookieJar }
            );

            const verified = await recoveryAuth.verifySession();
            if (!verified.success) {
                console.log('⚠️  Recovery session expired, re-authenticating...');
                const result = await recoveryAuth.login(['OUTLOOK']);
                if (!result.success) {
                    throw new Error('Failed to authenticate recovery account');
                }
            } else {
                console.log('✅ Recovery session is still valid');
            }
        } else {
            // Fresh recovery authentication
            recoveryAuth = new MicrosoftAuth(
                { email: recoveryEmail, password: 'qfyteepx6690270' }
            );
            const result = await recoveryAuth.login(['OUTLOOK']);
            if (!result.success) {
                throw new Error('Failed to authenticate recovery account');
            }
        }

        // Authenticate main account
        const mainAuth = new MicrosoftAuth(
            { email: mainEmail, password: 'wjqyizuv9542220' },
            {
                recoveryAccount: {
                    Add: true,
                    email: recoveryEmail,
                    session: recoveryAuth.session
                }
            }
        );

        const mainResult = await mainAuth.login(['ALL', 'OUTLOOK', 'REWARDS']);

        if (mainResult.success) {
            // Save both sessions
            await fs.mkdir('./sessions', { recursive: true });
            await fs.writeFile(`./sessions/${mainEmail}.json`, mainResult.cookieJar);
            await fs.writeFile(`./sessions/${recoveryEmail}.json`, recoveryAuth.session.exportCookieJar());
            
            console.log('✅ Authentication successful, sessions saved!');
            return { success: true, cookies: mainResult.cookies };
        } else {
            throw new Error(mainResult.error);
        }

    } catch (error) {
        console.error('❌ Authentication failed:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Example 5: Database integration
 */
async function authWithDatabaseIntegration() {
    console.log('=== Authentication with Database Integration ===\n');

    const mainEmail = 'dzmcjnmv5259@hotmail.com';

    try {
        // Load account from database
        const accountData = await Accounts.findOne({ email: mainEmail });
        
        if (!accountData) {
            throw new Error('Account not found in database');
        }

        console.log(`📂 Loaded account: ${accountData.email}`);

        // Load recovery account
        const recoveryData = await Accounts.findOne({ email: accountData.recoveryEmail });
        
        if (!recoveryData) {
            throw new Error('Recovery account not found in database');
        }

        // Authenticate recovery account
        const recoveryAuth = new MicrosoftAuth(
            { 
                email: recoveryData.email, 
                password: recoveryData.password 
            },
            { 
                cookieJar: recoveryData.cookieJar // Use saved session if available
            }
        );

        console.log('🔑 Checking recovery account session...');
        let recoveryVerified = await recoveryAuth.verifySession();
        
        if (!recoveryVerified.success) {
            console.log('🔄 Recovery session expired, re-authenticating...');
            const recoveryResult = await recoveryAuth.login(['OUTLOOK']);
            
            if (!recoveryResult.success) {
                throw new Error('Failed to authenticate recovery account');
            }

            // Update database with new session
            await Accounts.updateOne(
                { email: recoveryData.email },
                { 
                    $set: { 
                        cookieJar: recoveryResult.cookieJar,
                        lastAuthenticated: new Date()
                    }
                }
            );
        }

        // Authenticate main account
        const mainAuth = new MicrosoftAuth(
            { 
                email: accountData.email, 
                password: accountData.password 
            },
            {
                cookieJar: accountData.cookieJar, // Try existing session first
                recoveryAccount: {
                    Add: accountData.needsRecoveryEmail || false,
                    email: recoveryData.email,
                    session: recoveryAuth.session
                }
            }
        );

        console.log('🔑 Authenticating main account...');
        const mainResult = await mainAuth.login(['ALL', 'OUTLOOK', 'REWARDS', 'BING']);

        if (mainResult.success) {
            // Update database
            await Accounts.updateOne(
                { email: accountData.email },
                {
                    $set: {
                        cookieJar: mainResult.cookieJar,
                        cookies: mainResult.cookies,
                        lastAuthenticated: new Date(),
                        needsRecoveryEmail: false,
                        status: 'active'
                    }
                }
            );

            console.log('✅ Authentication successful and database updated!');
            return { success: true, cookies: mainResult.cookies };
        } else {
            // Update status
            await Accounts.updateOne(
                { email: accountData.email },
                {
                    $set: {
                        status: 'auth_failed',
                        lastError: mainResult.error,
                        lastChecked: new Date()
                    }
                }
            );

            throw new Error(mainResult.error);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Helper function to save account to database
 */
async function saveAccountToDatabase(data) {
    // Implement your database save logic
    console.log(`💾 Saving ${data.email} to database...`);
    
    // Example with Mongoose:
    // await Accounts.updateOne(
    //     { email: data.email },
    //     { $set: data },
    //     { upsert: true }
    // );
}

// Run examples
async function main() {
    console.log('🚀 Microsoft Authentication with Automatic OTP\n');
    console.log('='.repeat(50) + '\n');

    // Choose which example to run
    const example = process.argv[2] || '1';

    switch (example) {
        case '1':
            await simpleAutoOTPAuth();
            break;
        case '2':
            await authWithSavedRecoverySession();
            break;
        case '3':
            await batchAuthWithAutoOTP();
            break;
        case '4':
            await smartAuthWithSessionReuse();
            break;
        case '5':
            await authWithDatabaseIntegration();
            break;
        default:
            console.log('Usage: node script.js [1-5]');
            console.log('1: Simple auto-OTP authentication');
            console.log('2: Auth with saved recovery session');
            console.log('3: Batch processing');
            console.log('4: Smart session reuse');
            console.log('5: Database integration');
    }
}

// Run if executed directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    simpleAutoOTPAuth,
    authWithSavedRecoverySession,
    batchAuthWithAutoOTP,
    smartAuthWithSessionReuse,
    authWithDatabaseIntegration
};