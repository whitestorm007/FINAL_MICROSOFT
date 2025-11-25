# Database Setup Guide for Auth Worker

## Overview

The auth worker requires specific data structure in MongoDB to work properly, especially for the automatic ALT (alternative email) feature.

## Account Schema Requirements

Each account document in your MongoDB collection must have the following structure:

```javascript
{
  email: String,              // Main account email
  password: String,           // Main account password
  cookieJar: String,          // Serialized cookie jar (or null)

  // Recovery account configuration
  recoveryAccount: {
    email: String,            // Recovery account email
    password: String,         // Recovery account password (optional)
    set: Boolean              // Whether ALT has been added
  },

  // Account status
  accountStatus: String,      // 'ACTIVE', 'LOCKED', 'SUSPENDED', 'MANUAL_REVIEW'
  jobStatus: String,          // 'IDLE', 'RUNNING'
  currentTask: String,        // 'NONE', 'AUTH', 'AUTH_FULL', 'ALT', 'RE_AUTH'
  currentTaskError: String,   // Error message or 'None'

  // Worker tracking
  assignedWorkerId: String,   // ID of worker processing this account
  jobMessage: String,         // Last job status message

  // Session tracking
  lastSession: Date,          // Last successful authentication
  nextSessionEligible: Date,  // When next session can run

  // Optional: Proxy configuration
  proxy: {
    host: String,
    port: Number,
    username: String,
    password: String
  },

  // Flags
  isEnabled: Boolean,         // Whether account is enabled for processing

  // Timestamps
  createdAt: Date,
  updatedAt: Date
}
```

## Critical Requirements for ALT Feature

### 1. Recovery Account Must Exist in Database

**Important:** For the automatic ALT email feature to work, **both the main account AND its recovery account must exist as separate documents in the database.**

Example:

```javascript
// Main account
{
  email: 'mainaccount@hotmail.com',
  password: 'mainpass123',
  recoveryAccount: {
    email: 'recoveryaccount@hotmail.com',  // References another account
    set: false                              // Not yet added
  },
  isEnabled: true,
  accountStatus: 'ACTIVE',
  jobStatus: 'IDLE'
}

// Recovery account (MUST exist as a separate document)
{
  email: 'recoveryaccount@hotmail.com',
  password: 'recoverypass123',
  cookieJar: null,  // Will be populated when authenticated
  isEnabled: true,
  accountStatus: 'ACTIVE',
  jobStatus: 'IDLE'
}
```

### 2. How It Works

When adding ALT email:

1. Worker finds main account needing ALT
2. Worker looks up recovery account by `recoveryAccount.email`
3. Worker authenticates recovery account to get Outlook tokens
4. Worker uses recovery account's session to auto-fetch OTP codes
5. Worker adds ALT email to main account
6. Both accounts' `cookieJar` fields are updated in database

### 3. Recovery Account Authentication

The recovery account needs Outlook authentication to fetch OTP codes. The worker will:

1. Check if recovery account has a valid `cookieJar`
2. If yes, verify the session is still valid
3. If no or expired, authenticate the recovery account with `['ALL', 'OUTLOOK']`
4. Save the new `cookieJar` to the recovery account document

## Sample Data Structure

### Complete Example

```javascript
// Collection: accounts3

// Document 1: Main account
{
  _id: ObjectId("..."),
  email: "user123@hotmail.com",
  password: "SecurePass123!",
  batchIdentifier: "batch-001",

  recoveryAccount: {
    email: "recovery456@hotmail.com",
    password: null,  // Optional, will be fetched from recovery account doc
    set: false
  },

  dailyLimits: {
    pc: 50,
    mobile: 30
  },

  searchProgress: {
    pc: 0,
    mobile: 0
  },

  jobStatus: "IDLE",
  currentTask: "ALT",  // Needs ALT email added
  currentTaskError: "None",
  assignedWorkerId: null,

  accountStatus: "ACTIVE",
  isEnabled: true,

  cookieJar: null,  // No session yet
  lastSession: null,
  nextSessionEligible: new Date(),

  createdAt: new Date("2025-10-25"),
  updatedAt: new Date("2025-10-31")
}

// Document 2: Recovery account
{
  _id: ObjectId("..."),
  email: "recovery456@hotmail.com",
  password: "RecoveryPass456!",
  batchIdentifier: "batch-recovery",

  recoveryAccount: {
    set: true  // This account already has ALT
  },

  jobStatus: "IDLE",
  currentTask: "NONE",
  currentTaskError: "None",
  assignedWorkerId: null,

  accountStatus: "ACTIVE",
  isEnabled: true,

  // This will be populated after first authentication
  cookieJar: '{"cookies":[...], "metadata":{...}}',

  lastSession: new Date("2025-10-30"),
  nextSessionEligible: new Date("2025-11-01"),

  createdAt: new Date("2025-10-20"),
  updatedAt: new Date("2025-10-30")
}
```

## Setting Up Accounts

### Option 1: Manual Insert

```javascript
// MongoDB Shell or Compass

// Insert recovery accounts first
db.accounts3.insertOne({
  email: "recovery1@hotmail.com",
  password: "pass123",
  batchIdentifier: "recovery-batch",
  accountStatus: "ACTIVE",
  jobStatus: "IDLE",
  currentTask: "NONE",
  currentTaskError: "None",
  isEnabled: true,
  cookieJar: null,
  recoveryAccount: { set: true },
  dailyLimits: { pc: 50, mobile: 30 },
  searchProgress: { pc: 0, mobile: 0 },
  createdAt: new Date(),
  updatedAt: new Date()
});

// Then insert main accounts
db.accounts3.insertOne({
  email: "main1@hotmail.com",
  password: "pass456",
  batchIdentifier: "main-batch",
  recoveryAccount: {
    email: "recovery1@hotmail.com",
    set: false
  },
  accountStatus: "ACTIVE",
  jobStatus: "IDLE",
  currentTask: "ALT",
  currentTaskError: "None",
  isEnabled: true,
  cookieJar: null,
  dailyLimits: { pc: 50, mobile: 30 },
  searchProgress: { pc: 0, mobile: 0 },
  createdAt: new Date(),
  updatedAt: new Date()
});
```

### Option 2: Node.js Script

```javascript
const mongoose = require('mongoose');
const RewardsAccountModel = require('./model/db');

async function setupAccounts() {
  await mongoose.connect('mongodb://localhost:27017/microsoft-accounts');

  // Create recovery account
  const recoveryAccount = await RewardsAccountModel.create({
    email: "recovery@hotmail.com",
    password: "recoverypass123",
    batchIdentifier: "recovery-batch",
    accountStatus: "ACTIVE",
    jobStatus: "IDLE",
    currentTask: "NONE",
    currentTaskError: "None",
    isEnabled: true,
    recoveryAccount: { set: true }
  });

  // Create main account
  const mainAccount = await RewardsAccountModel.create({
    email: "main@hotmail.com",
    password: "mainpass123",
    batchIdentifier: "main-batch",
    recoveryAccount: {
      email: "recovery@hotmail.com",
      set: false
    },
    accountStatus: "ACTIVE",
    jobStatus: "IDLE",
    currentTask: "ALT",
    currentTaskError: "None",
    isEnabled: true
  });

  console.log('Accounts created successfully!');
  await mongoose.disconnect();
}

setupAccounts().catch(console.error);
```

## Querying Accounts

### Find accounts needing ALT

```javascript
db.accounts3.find({
  isEnabled: true,
  accountStatus: "ACTIVE",
  "recoveryAccount.set": { $ne: true }
})
```

### Find accounts with missing cookies

```javascript
db.accounts3.find({
  isEnabled: true,
  accountStatus: "ACTIVE",
  $or: [
    { cookieJar: null },
    { cookieJar: "" }
  ]
})
```

### Find accounts being processed

```javascript
db.accounts3.find({
  jobStatus: "RUNNING"
})
```

### Find accounts with errors

```javascript
db.accounts3.find({
  currentTaskError: { $ne: "None" }
})
```

## Common Issues

### Issue 1: "Recovery account not found in database"

**Cause:** The recovery account email exists in `mainAccount.recoveryAccount.email` but doesn't have its own document in the collection.

**Solution:** Create a separate document for the recovery account.

### Issue 2: "Failed to authenticate recovery account"

**Cause:** Recovery account credentials are invalid or account is locked.

**Solution:**
- Verify credentials are correct
- Check `accountStatus` of recovery account
- Manually test login for recovery account

### Issue 3: ALT keeps failing with timeout

**Cause:** Recovery account doesn't have Outlook authentication.

**Solution:** Ensure recovery account is authenticated with `['OUTLOOK']` cookie type.

### Issue 4: Both accounts stuck in RUNNING

**Cause:** Worker crashed while processing.

**Solution:**
```javascript
db.accounts3.updateMany(
  { jobStatus: "RUNNING" },
  { $set: {
    jobStatus: "IDLE",
    assignedWorkerId: null,
    jobMessage: "Reset by admin"
  }}
)
```

## Best Practices

1. **Pre-authenticate recovery accounts**: Before adding them as recovery accounts, ensure they're already authenticated with Outlook.

2. **One recovery account per multiple main accounts**: You can use the same recovery account for multiple main accounts.

3. **Keep recovery accounts enabled**: Don't disable recovery accounts while they're being used.

4. **Monitor recovery account status**: If a recovery account gets locked, all main accounts using it will fail.

5. **Regular cookie refresh**: Recovery accounts should have their sessions refreshed regularly to ensure they can fetch OTP codes.

## Index Recommendations

For optimal performance, create these indexes:

```javascript
// Email index (unique)
db.accounts3.createIndex({ email: 1 }, { unique: true })

// Job status index
db.accounts3.createIndex({ jobStatus: 1 })

// Recovery account lookup
db.accounts3.createIndex({ "recoveryAccount.email": 1 })

// Batch identifier
db.accounts3.createIndex({ batchIdentifier: 1 })

// Worker assignment
db.accounts3.createIndex({ assignedWorkerId: 1 })

// Compound index for finding bad accounts
db.accounts3.createIndex({
  isEnabled: 1,
  accountStatus: 1,
  jobStatus: 1,
  "recoveryAccount.set": 1
})
```

## Verification Script

Run this to verify your database is set up correctly:

```javascript
const RewardsAccountModel = require('./model/db');

async function verifySetup() {
  // Find all main accounts with recovery emails
  const mainAccounts = await RewardsAccountModel.find({
    'recoveryAccount.email': { $exists: true, $ne: null }
  });

  console.log(`Found ${mainAccounts.length} accounts with recovery emails`);

  for (const account of mainAccounts) {
    const recoveryEmail = account.recoveryAccount.email;

    // Check if recovery account exists
    const recoveryExists = await RewardsAccountModel.findOne({
      email: recoveryEmail
    });

    if (!recoveryExists) {
      console.warn(`❌ ${account.email} -> Recovery ${recoveryEmail} NOT FOUND`);
    } else {
      console.log(`✅ ${account.email} -> Recovery ${recoveryEmail} OK`);
    }
  }
}

verifySetup().catch(console.error);
```
