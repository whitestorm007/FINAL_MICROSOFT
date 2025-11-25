const fs = require('fs').promises;
require('dotenv').config();
const mongoose = require('mongoose');

const db = require("./model/db");
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/default_db';

// MongoDB connection with retry logic
const connectDB = async (retries = 5) => {
    for (let i = 0; i < retries; i++) {
        try {
            await mongoose.connect(MONGODB_URI);
            console.log('MongoDB connected successfully');
            return true;
        } catch (error) {
            console.error(`MongoDB connection attempt ${i + 1}/${retries} failed:`, error.message);
            if (i === retries - 1) {
                console.error('All connection attempts failed');
                process.exit(1);
            }
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
};

// Robust file reading with validation
async function extractAndPairCredentials(filePath) {
    try {
        // Check if file exists
        await fs.access(filePath);
        
        const data = await fs.readFile(filePath, 'utf8');
        
        if (!data || data.trim().length === 0) {
            throw new Error('File is empty');
        }
        
        const lines = data.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
            throw new Error('No valid lines found in file');
        }
        
        const credentials = lines.map((line, index) => {
            const match = line.match(/:\s*([^;]+);(.+)$/);
            if (match) {
                const email = match[1].trim();
                const password = match[2].trim();
                
                // Basic email validation
                if (!email.includes('@') || email.length < 5) {
                    console.warn(`Line ${index + 1}: Invalid email format - ${email}`);
                    return null;
                }
                
                if (!password || password.length < 3) {
                    console.warn(`Line ${index + 1}: Invalid password for ${email}`);
                    return null;
                }
                
                return { email, password };
            }
            console.warn(`Line ${index + 1}: Could not parse - ${line}`);
            return null;
        }).filter(cred => cred !== null);

        if (credentials.length === 0) {
            throw new Error('No valid credentials found in file');
        }

        const pairs = [];
        for (let i = 0; i < credentials.length; i += 2) {
            if (i + 1 < credentials.length) {
                pairs.push([credentials[i], credentials[i + 1]]);
            } else {
                console.warn(`Odd number of credentials: ${credentials[i].email} has no pair`);
                pairs.push([credentials[i], null]);
            }
        }

        return {
            allCredentials: credentials,
            pairedCredentials: pairs
        };

    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`File not found: ${filePath}`);
        } else {
            console.error('Error reading file:', error.message);
        }
        throw error;
    }
}

// Robust save function with detailed error handling
async function savePairToDB(pair, batchIdentifier, pairIndex) {
    const results = {
        pair: pairIndex,
        account1: null,
        account2: null,
        success: false,
        errors: []
    };

    // Validate pair
    if (!pair[0]) {
        results.errors.push('Missing first account in pair');
        return results;
    }

    try {
        // Create first account
        const dbs1 = new db({
            email: pair[0].email,
            password: pair[0].password,
            batchIdentifier: batchIdentifier,
            recoveryAccount: pair[1] ? {
                email: pair[1].email,
                password: pair[1].password,
                set: false
            } : null,
            currentTask: "AUTH_FULL",
            accountStatus: "ACTIVE",
            isEnabled: true
        });

        // Save first account
        try {
            results.account1 = await dbs1.save();
            console.log(`✓ Saved account 1 of pair ${pairIndex}: ${pair[0].email}`);
        } catch (error) {
            console.error(`✗ Failed to save account 1 of pair ${pairIndex}:`, error.message);
            results.errors.push(`Account 1 (${pair[0].email}): ${error.message}`);
        }

        // Only create second account if pair[1] exists
        if (pair[1]) {
            const dbs2 = new db({
                email: pair[1].email,
                password: pair[1].password,
                batchIdentifier: batchIdentifier,
                recoveryAccount: {
                    email: pair[0].email,
                    password: pair[0].password,
                    set: false
                },
                currentTask: "AUTH_FULL",
                accountStatus: "ACTIVE",
                isEnabled: true
            });

            // Save second account
            try {
                results.account2 = await dbs2.save();
                console.log(`✓ Saved account 2 of pair ${pairIndex}: ${pair[1].email}`);
            } catch (error) {
                console.error(`✗ Failed to save account 2 of pair ${pairIndex}:`, error.message);
                results.errors.push(`Account 2 (${pair[1].email}): ${error.message}`);
            }
        }

        // Determine success
        results.success = results.account1 !== null && (pair[1] ? results.account2 !== null : true);
        
    } catch (error) {
        console.error(`✗ Unexpected error in pair ${pairIndex}:`, error.message);
        results.errors.push(`Unexpected: ${error.message}`);
    }

    return results;
}

// Main function with comprehensive error handling
async function main() {
    const batchIdentifier = "FIRST_TEST_10.3";
    let result;
    
    try {
        // Extract credentials
        result = await extractAndPairCredentials('plain.txt');
        
        console.log(`\n📊 Found ${result.allCredentials.length} credentials`);
        console.log(`📦 Created ${result.pairedCredentials.length} pairs\n`);

    } catch (error) {
        console.error('Failed to extract credentials:', error.message);
        process.exit(1);
    }

    // Process pairs sequentially to avoid overwhelming DB
    const saveResults = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < result.pairedCredentials.length; i++) {
        const pair = result.pairedCredentials[i];
        console.log(`\n--- Processing Pair ${i + 1}/${result.pairedCredentials.length} ---`);
        
        const saveResult = await savePairToDB(pair, batchIdentifier, i + 1);
        saveResults.push(saveResult);
        
        if (saveResult.success) {
            successCount++;
        } else {
            failCount++;
        }
        
        // Small delay to prevent DB overload
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Summary report
    console.log('\n' + '='.repeat(50));
    console.log('📈 IMPORT SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total Pairs: ${result.pairedCredentials.length}`);
    console.log(`✓ Successful: ${successCount}`);
    console.log(`✗ Failed: ${failCount}`);
    
    if (failCount > 0) {
        console.log('\n❌ ERRORS:');
        saveResults.forEach((result, idx) => {
            if (result.errors.length > 0) {
                console.log(`\nPair ${result.pair}:`);
                result.errors.forEach(err => console.log(`  - ${err}`));
            }
        });
    }
    
    console.log('='.repeat(50) + '\n');
    
    // Close DB connection gracefully
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    
    process.exit(failCount > 0 ? 1 : 0);
}

// Graceful shutdown handlers
process.on('SIGINT', async () => {
    console.log('\n\n⚠️  Received SIGINT, closing gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n\n⚠️  Received SIGTERM, closing gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

// Start the application
connectDB()
    .then(() => main())
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });

module.exports = { extractAndPairCredentials, savePairToDB };