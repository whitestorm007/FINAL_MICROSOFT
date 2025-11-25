require('dotenv').config();
const mongoose = require('mongoose');
const RewardsAccountModel = require('./model/db');

// ============================================================================
// DATABASE VERIFICATION SCRIPT
// ============================================================================

const CONFIG = {
    MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/microsoft-accounts'
};

class DatabaseVerifier {

    /**
     * Verify recovery account setup
     */
    static async verifyRecoveryAccounts() {
        console.log('\n=== VERIFYING RECOVERY ACCOUNT SETUP ===\n');

        // Find all main accounts with recovery emails
        const mainAccounts = await RewardsAccountModel.find({
            'recoveryAccount.email': { $exists: true, $ne: null }
        });

        console.log(`Found ${mainAccounts.length} account(s) with recovery email configured\n`);

        if (mainAccounts.length === 0) {
            console.log('ℹ️  No accounts have recovery emails configured');
            return { valid: 0, invalid: 0, missing: 0 };
        }

        let valid = 0;
        let invalid = 0;
        let missing = 0;

        for (const account of mainAccounts) {
            const recoveryEmail = account.recoveryAccount.email;

            // Check if recovery account exists as a document
            const recoveryAccount = await RewardsAccountModel.findOne({
                email: recoveryEmail
            });

            if (!recoveryAccount) {
                console.log(`❌ ${account.email}`);
                console.log(`   Recovery: ${recoveryEmail} - NOT FOUND IN DATABASE`);
                console.log(`   Action: Create a document for ${recoveryEmail}\n`);
                missing++;
            } else {
                // Check if recovery account has valid credentials
                if (!recoveryAccount.password) {
                    console.log(`⚠️  ${account.email}`);
                    console.log(`   Recovery: ${recoveryEmail} - MISSING PASSWORD`);
                    console.log(`   Action: Add password to ${recoveryEmail}\n`);
                    invalid++;
                } else if (!recoveryAccount.isEnabled) {
                    console.log(`⚠️  ${account.email}`);
                    console.log(`   Recovery: ${recoveryEmail} - DISABLED`);
                    console.log(`   Action: Enable ${recoveryEmail}\n`);
                    invalid++;
                } else if (recoveryAccount.accountStatus === 'LOCKED' || recoveryAccount.accountStatus === 'SUSPENDED') {
                    console.log(`⚠️  ${account.email}`);
                    console.log(`   Recovery: ${recoveryEmail} - ${recoveryAccount.accountStatus}`);
                    console.log(`   Action: Fix status of ${recoveryEmail}\n`);
                    invalid++;
                } else {
                    console.log(`✅ ${account.email}`);
                    console.log(`   Recovery: ${recoveryEmail} - OK`);
                    console.log(`   Has cookies: ${recoveryAccount.cookieJar ? 'Yes' : 'No'}`);
                    console.log(`   Status: ${recoveryAccount.accountStatus}\n`);
                    valid++;
                }
            }
        }

        console.log('--- Summary ---');
        console.log(`✅ Valid: ${valid}`);
        console.log(`⚠️  Issues: ${invalid}`);
        console.log(`❌ Missing: ${missing}`);

        return { valid, invalid, missing };
    }

    /**
     * Find orphaned recovery accounts
     */
    static async findOrphanedRecoveryAccounts() {
        console.log('\n=== FINDING ORPHANED RECOVERY ACCOUNTS ===\n');

        const allAccounts = await RewardsAccountModel.find({});
        const recoveryEmails = new Set();

        // Collect all recovery emails
        for (const account of allAccounts) {
            if (account.recoveryAccount?.email) {
                recoveryEmails.add(account.recoveryAccount.email);
            }
        }

        console.log(`Found ${recoveryEmails.size} unique recovery email(s) referenced\n`);

        // Find accounts that might be recovery accounts but aren't used
        const potentialRecovery = await RewardsAccountModel.find({
            'recoveryAccount.set': true
        });

        let orphaned = 0;

        for (const account of potentialRecovery) {
            if (!recoveryEmails.has(account.email)) {
                console.log(`⚠️  ${account.email} - Has ALT set but not used as recovery by any account`);
                orphaned++;
            }
        }

        if (orphaned === 0) {
            console.log('✅ No orphaned recovery accounts found');
        } else {
            console.log(`\nFound ${orphaned} orphaned recovery account(s)`);
        }

        return orphaned;
    }

    /**
     * Check for circular recovery references
     */
    static async checkCircularReferences() {
        console.log('\n=== CHECKING FOR CIRCULAR RECOVERY REFERENCES ===\n');

        const accounts = await RewardsAccountModel.find({
            'recoveryAccount.email': { $exists: true }
        });

        let circular = 0;

        for (const account of accounts) {
            const recoveryEmail = account.recoveryAccount.email;
            const recoveryAccount = await RewardsAccountModel.findOne({
                email: recoveryEmail
            });

            if (recoveryAccount && recoveryAccount.recoveryAccount?.email === account.email) {
                console.log(`❌ CIRCULAR: ${account.email} ↔ ${recoveryEmail}`);
                circular++;
            }
        }

        if (circular === 0) {
            console.log('✅ No circular references found');
        } else {
            console.log(`\n❌ Found ${circular} circular reference(s)`);
        }

        return circular;
    }

    /**
     * List recovery accounts needing authentication
     */
    static async checkRecoveryAccountCookies() {
        console.log('\n=== RECOVERY ACCOUNTS NEEDING AUTHENTICATION ===\n');

        // Get all unique recovery emails
        const mainAccounts = await RewardsAccountModel.find({
            'recoveryAccount.email': { $exists: true, $ne: null }
        });

        const recoveryEmails = [...new Set(mainAccounts.map(a => a.recoveryAccount.email))];

        console.log(`Checking ${recoveryEmails.length} recovery account(s)...\n`);

        let needsAuth = 0;

        for (const email of recoveryEmails) {
            const account = await RewardsAccountModel.findOne({ email });

            if (!account) {
                console.log(`❌ ${email} - NOT FOUND`);
                needsAuth++;
            } else if (!account.cookieJar || account.cookieJar === '') {
                console.log(`⚠️  ${email} - NO COOKIES (needs authentication)`);
                needsAuth++;
            } else {
                // Count how many accounts use this recovery
                const usedBy = mainAccounts.filter(a => a.recoveryAccount.email === email).length;
                console.log(`✅ ${email} - Has cookies (used by ${usedBy} account(s))`);
            }
        }

        if (needsAuth === 0) {
            console.log('\n✅ All recovery accounts have cookies');
        } else {
            console.log(`\n⚠️  ${needsAuth} recovery account(s) need authentication`);
        }

        return needsAuth;
    }

    /**
     * Verify database indexes
     */
    static async verifyIndexes() {
        console.log('\n=== VERIFYING DATABASE INDEXES ===\n');

        const collection = mongoose.connection.collection('accounts3');
        const indexes = await collection.indexes();

        console.log('Current indexes:');
        indexes.forEach(index => {
            console.log(`  - ${JSON.stringify(index.key)} ${index.unique ? '(unique)' : ''}`);
        });

        // Check for recommended indexes
        const recommended = [
            { email: 1 },
            { jobStatus: 1 },
            { 'recoveryAccount.email': 1 }
        ];

        console.log('\nRecommended indexes:');
        recommended.forEach(rec => {
            const exists = indexes.some(idx => {
                return JSON.stringify(idx.key) === JSON.stringify(rec);
            });
            console.log(`  ${exists ? '✅' : '❌'} ${JSON.stringify(rec)}`);
        });
    }

    /**
     * Show accounts ready for ALT processing
     */
    static async showReadyForALT() {
        console.log('\n=== ACCOUNTS READY FOR ALT PROCESSING ===\n');

        const accounts = await RewardsAccountModel.find({
            isEnabled: true,
            accountStatus: { $in: ['ACTIVE', 'MANUAL_REVIEW'] },
            jobStatus: 'IDLE',
            'recoveryAccount.set': { $ne: true },
            'recoveryAccount.email': { $exists: true, $ne: null }
        }).limit(20);

        if (accounts.length === 0) {
            console.log('ℹ️  No accounts ready for ALT processing');
            return 0;
        }

        console.log(`Found ${accounts.length} account(s) ready for ALT:\n`);

        for (const account of accounts) {
            // Check if recovery account is ready
            const recovery = await RewardsAccountModel.findOne({
                email: account.recoveryAccount.email
            });

            const recoveryReady = recovery && recovery.cookieJar && recovery.isEnabled;

            console.log(`${recoveryReady ? '✅' : '❌'} ${account.email}`);
            console.log(`   Recovery: ${account.recoveryAccount.email}`);
            console.log(`   Recovery Ready: ${recoveryReady ? 'Yes' : 'No'}`);
            console.log('');
        }

        return accounts.length;
    }

    /**
     * Generate fix script for missing recovery accounts
     */
    static async generateFixScript() {
        console.log('\n=== GENERATING FIX SCRIPT ===\n');

        const mainAccounts = await RewardsAccountModel.find({
            'recoveryAccount.email': { $exists: true, $ne: null }
        });

        const missingRecovery = [];

        for (const account of mainAccounts) {
            const recoveryEmail = account.recoveryAccount.email;
            const exists = await RewardsAccountModel.findOne({ email: recoveryEmail });

            if (!exists) {
                missingRecovery.push(recoveryEmail);
            }
        }

        if (missingRecovery.length === 0) {
            console.log('✅ No missing recovery accounts - nothing to fix!');
            return;
        }

        console.log(`Found ${missingRecovery.length} missing recovery account(s)\n`);
        console.log('Copy and run this script to create them:\n');
        console.log('```javascript');
        console.log('const mongoose = require("mongoose");');
        console.log('const RewardsAccountModel = require("./model/db");\n');
        console.log('async function createMissingRecoveryAccounts() {');
        console.log('  await mongoose.connect("' + CONFIG.MONGO_URI + '");\n');

        const unique = [...new Set(missingRecovery)];

        for (const email of unique) {
            console.log(`  await RewardsAccountModel.create({`);
            console.log(`    email: "${email}",`);
            console.log(`    password: "YOUR_PASSWORD_HERE", // UPDATE THIS!`);
            console.log(`    batchIdentifier: "recovery-batch",`);
            console.log(`    accountStatus: "ACTIVE",`);
            console.log(`    jobStatus: "IDLE",`);
            console.log(`    currentTask: "NONE",`);
            console.log(`    currentTaskError: "None",`);
            console.log(`    isEnabled: true,`);
            console.log(`    recoveryAccount: { set: true }`);
            console.log(`  });\n`);
        }

        console.log('  console.log("Created all missing recovery accounts!");');
        console.log('  await mongoose.disconnect();');
        console.log('}');
        console.log('\ncreateMissingRecoveryAccounts().catch(console.error);');
        console.log('```\n');
    }

    /**
     * Full verification
     */
    static async runFullVerification() {
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║           DATABASE VERIFICATION FOR AUTH WORKER                ║');
        console.log('╚════════════════════════════════════════════════════════════════╝');

        const results = {};

        // 1. Verify recovery accounts
        results.recovery = await this.verifyRecoveryAccounts();

        // 2. Check circular references
        results.circular = await this.checkCircularReferences();

        // 3. Check recovery account cookies
        results.needsAuth = await this.checkRecoveryAccountCookies();

        // 4. Find orphaned accounts
        results.orphaned = await this.findOrphanedRecoveryAccounts();

        // 5. Show ready for ALT
        results.readyForALT = await this.showReadyForALT();

        // 6. Verify indexes
        await this.verifyIndexes();

        // 7. Generate fix script if needed
        if (results.recovery.missing > 0) {
            await this.generateFixScript();
        }

        // Summary
        console.log('\n╔════════════════════════════════════════════════════════════════╗');
        console.log('║                         SUMMARY                                ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        const issues = results.recovery.invalid + results.recovery.missing + results.circular + results.needsAuth;

        if (issues === 0) {
            console.log('✅ Database is properly configured!');
            console.log(`✅ ${results.readyForALT} account(s) ready for ALT processing`);
        } else {
            console.log('⚠️  Issues found:');
            if (results.recovery.missing > 0) {
                console.log(`   - ${results.recovery.missing} missing recovery account(s)`);
            }
            if (results.recovery.invalid > 0) {
                console.log(`   - ${results.recovery.invalid} recovery account(s) with issues`);
            }
            if (results.circular > 0) {
                console.log(`   - ${results.circular} circular reference(s)`);
            }
            if (results.needsAuth > 0) {
                console.log(`   - ${results.needsAuth} recovery account(s) need authentication`);
            }
            console.log('\n⚠️  Please fix these issues before running the auth worker');
        }

        console.log('');
        return issues === 0;
    }
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

async function main() {
    const command = process.argv[2];

    try {
        // Connect to database
        console.log(`Connecting to: ${CONFIG.MONGO_URI}\n`);
        await mongoose.connect(CONFIG.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });

        switch (command) {
            case 'recovery':
                await DatabaseVerifier.verifyRecoveryAccounts();
                break;

            case 'cookies':
                await DatabaseVerifier.checkRecoveryAccountCookies();
                break;

            case 'circular':
                await DatabaseVerifier.checkCircularReferences();
                break;

            case 'orphaned':
                await DatabaseVerifier.findOrphanedRecoveryAccounts();
                break;

            case 'ready':
                await DatabaseVerifier.showReadyForALT();
                break;

            case 'indexes':
                await DatabaseVerifier.verifyIndexes();
                break;

            case 'fix':
                await DatabaseVerifier.generateFixScript();
                break;

            case 'full':
            default:
                const isValid = await DatabaseVerifier.runFullVerification();
                process.exit(isValid ? 0 : 1);
        }

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
    }
}

// ============================================================================
// HELP
// ============================================================================

if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('\n=== Database Verification Tool ===\n');
    console.log('Usage: node verify-database.js [command]\n');
    console.log('Commands:');
    console.log('  full      - Run full verification (default)');
    console.log('  recovery  - Verify recovery account setup');
    console.log('  cookies   - Check recovery account authentication');
    console.log('  circular  - Check for circular references');
    console.log('  orphaned  - Find orphaned recovery accounts');
    console.log('  ready     - Show accounts ready for ALT');
    console.log('  indexes   - Verify database indexes');
    console.log('  fix       - Generate fix script for issues');
    console.log('');
    console.log('Examples:');
    console.log('  node verify-database.js');
    console.log('  node verify-database.js recovery');
    console.log('  node verify-database.js fix');
    console.log('');
    process.exit(0);
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

module.exports = DatabaseVerifier;
