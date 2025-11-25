# ALT Email System - How It Works

## Overview

The automatic alternative email (ALT) system allows the auth worker to add recovery emails to Microsoft accounts without manual OTP input. This document explains how the system works and what was fixed.

## The Problem (Before Fix)

The original `auth.js` tried to add ALT emails like this:

```javascript
async addAlternativeEmail(auth, account) {
    // Login to main account
    const loginResult = await auth.login(['ALL']);

    // Try to add ALT
    const altResult = await auth.Alt();

    // ❌ FAILS: No recovery account session to fetch OTP codes
}
```

**Issue:** When Microsoft sends an OTP code to the recovery email, there's no way to automatically fetch it because the recovery account isn't authenticated.

## The Solution (After Fix)

The fixed system works in 5 steps:

### Step 1: Database Setup

Both main and recovery accounts exist as separate documents:

```javascript
// Main account
{
  email: "main@hotmail.com",
  password: "mainpass",
  recoveryAccount: {
    email: "recovery@hotmail.com",  // Points to another doc
    set: false                        // ALT not added yet
  }
}

// Recovery account (separate document)
{
  email: "recovery@hotmail.com",
  password: "recoverypass",
  cookieJar: "{...}",  // Contains Outlook tokens
  recoveryAccount: {
    set: true  // This account already has ALT
  }
}
```

### Step 2: Worker Finds Account Needing ALT

```javascript
const account = await RewardsAccountModel.findOne({
  isEnabled: true,
  accountStatus: 'ACTIVE',
  'recoveryAccount.set': false,
  'recoveryAccount.email': { $exists: true }
});
// Found: main@hotmail.com
```

### Step 3: Authenticate Recovery Account

```javascript
// Lookup recovery account in database
const recoveryAccount = await RewardsAccountModel.findOne({
  email: account.recoveryAccount.email
});
// Found: recovery@hotmail.com

// Authenticate it to get Outlook tokens
const recoveryAuth = new MicrosoftAuth(
  { email: "recovery@hotmail.com", password: "recoverypass" },
  { cookieJar: recoveryAccount.cookieJar }
);

await recoveryAuth.login(['ALL', 'OUTLOOK']);
// Now recovery account has session with Outlook API access
```

### Step 4: Pass Recovery Session to Main Account

```javascript
const mainAuth = new MicrosoftAuth(
  { email: "main@hotmail.com", password: "mainpass" },
  {
    recoveryAccount: {
      Add: true,
      email: "recovery@hotmail.com",
      session: recoveryAuth.session  // ✅ This enables auto-OTP!
    }
  }
);
```

### Step 5: Automatic OTP Fetching

When Microsoft sends OTP code to recovery@hotmail.com:

```javascript
// Inside EnhancedRedirectHandler.analyzeRedirect()
if (frmVerifyProof && config.recoveryAccount?.session) {

  // Get Outlook tokens from recovery session
  const tokens = config.recoveryAccount.session.getMetadata('outlookTokens');
  const mailbox = config.recoveryAccount.session.getMetadata('mailboxValue');

  // Create OTP fetcher
  const otpFetcher = new OutlookOTPFetcher(tokens.access_token, mailbox);

  // Wait for OTP email to arrive
  const result = await otpFetcher.waitForOTP({
    timeout: 120000,     // 2 minutes
    pollInterval: 5000,  // Check every 5 seconds
    maxAge: 300000       // Accept emails from last 5 minutes
  });

  // ✅ OTP automatically fetched!
  console.log(`OTP: ${result.otp}`);

  // Submit the form
  payload.iOttText = result.otp;
  return { type: 'AUTO_SUBMIT', url: formUrl, payload };
}
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      AUTH WORKER                            │
│                                                             │
│  1. Find account needing ALT                                │
│     ↓                                                        │
│  2. Query: main@hotmail.com                                 │
│     - recoveryAccount.email = "recovery@hotmail.com"        │
│     - recoveryAccount.set = false                           │
│     ↓                                                        │
│  3. Lookup recovery account in DB                           │
│     ↓                                                        │
│  4. Authenticate recovery@hotmail.com                       │
│     - Get Outlook tokens                                    │
│     - Save to recovery account's session                    │
│     ↓                                                        │
│  5. Create main account auth with recovery session          │
│     ↓                                                        │
│  6. Login to main@hotmail.com                               │
│     - Microsoft asks to add ALT email                       │
│     - Add recovery@hotmail.com as ALT                       │
│     - Microsoft sends OTP to recovery@hotmail.com           │
│     ↓                                                        │
│  7. EnhancedRedirectHandler detects OTP form                │
│     ↓                                                        │
│  8. OutlookOTPFetcher uses recovery session                 │
│     - Connects to Outlook API                               │
│     - Fetches recent emails                                 │
│     - Extracts OTP code from Microsoft email                │
│     ↓                                                        │
│  9. Submit OTP code automatically                           │
│     ↓                                                        │
│ 10. ALT email added successfully!                           │
│     - Update main account: recoveryAccount.set = true       │
│     - Update main account: cookieJar = new cookies          │
│     - Update recovery account: cookieJar = refreshed        │
└─────────────────────────────────────────────────────────────┘

DATABASE:
┌──────────────────────────┐      ┌──────────────────────────┐
│ main@hotmail.com         │      │ recovery@hotmail.com     │
│                          │      │                          │
│ recoveryAccount: {       │─────▶│ email: "recovery@..."    │
│   email: "recovery@..."  │      │ password: "..."          │
│   set: false → true      │      │ cookieJar: "{...}"       │
│ }                        │      │ (Outlook tokens)         │
│ cookieJar: null → "{...}"│      │                          │
└──────────────────────────┘      └──────────────────────────┘
```

## Key Components

### 1. **auth.js - addAlternativeEmail()**

Fixed function that:
- Finds recovery account in database
- Authenticates recovery account
- Passes recovery session to main account
- Handles full authentication flow

### 2. **integrated-auth.js - EnhancedRedirectHandler**

Detects OTP forms and automatically fetches codes using recovery account session.

### 3. **outlook-otp-fetcher.js - OutlookOTPFetcher**

Fetches OTP codes from Outlook using:
- Access token from recovery account
- Mailbox value for API calls
- Polling mechanism to wait for email

### 4. **microsoft-auth.js - MicrosoftAuth**

Main authentication class that:
- Accepts recovery account configuration
- Uses EnhancedRedirectHandler for redirects
- Stores session metadata (Outlook tokens)

## Data Flow

```
User Request (Add ALT)
    ↓
Worker finds account
    ↓
Fetch recovery account from DB
    ↓
Authenticate recovery account
    ├─→ Check if cookieJar exists
    ├─→ Verify session validity
    └─→ Login if needed (get Outlook tokens)
    ↓
Create main account auth
    └─→ Pass recovery session
    ↓
Main account login
    └─→ Microsoft: "Add recovery email"
    └─→ Add recovery@hotmail.com
    └─→ Microsoft sends OTP
    ↓
EnhancedRedirectHandler
    └─→ Detect OTP form
    └─→ Check for recovery session
    ↓
OutlookOTPFetcher
    ├─→ Use recovery tokens
    ├─→ Poll Outlook API
    ├─→ Find Microsoft email
    └─→ Extract OTP code
    ↓
Submit OTP
    ↓
Success!
    ├─→ Update main account (set: true)
    └─→ Save new cookies
```

## Database Requirements

### Required Fields

**Main Account:**
- `email`: Main account email
- `password`: Main account password
- `recoveryAccount.email`: Email of recovery account (must exist in DB)
- `recoveryAccount.set`: Boolean (false = needs ALT)
- `cookieJar`: Serialized cookies (can be null initially)

**Recovery Account:**
- `email`: Recovery account email (referenced by main accounts)
- `password`: Recovery account password
- `cookieJar`: Serialized cookies WITH Outlook tokens
- `isEnabled`: true
- `accountStatus`: 'ACTIVE'

### Critical Rule

**The recovery account MUST exist as a separate document in the database with the same email as specified in `mainAccount.recoveryAccount.email`.**

❌ **Wrong:**
```javascript
{
  email: "main@hotmail.com",
  recoveryAccount: {
    email: "recovery@hotmail.com",
    password: "recoverypass"  // Inline credentials
  }
}
// No separate document for recovery@hotmail.com
```

✅ **Correct:**
```javascript
// Document 1
{
  email: "main@hotmail.com",
  recoveryAccount: {
    email: "recovery@hotmail.com"  // Reference only
  }
}

// Document 2 (separate)
{
  email: "recovery@hotmail.com",
  password: "recoverypass",
  cookieJar: "{...}"
}
```

## Verification

Use the verification script to check your setup:

```bash
node verify-database.js
```

This will:
- ✅ Check all recovery account references
- ✅ Verify recovery accounts exist as documents
- ✅ Check if recovery accounts have valid cookies
- ✅ Detect circular references
- ✅ Show accounts ready for ALT processing
- ✅ Generate fix scripts for issues

## Troubleshooting

### "Recovery account not found in database"

**Solution:** Create a document for the recovery account:

```javascript
await RewardsAccountModel.create({
  email: "recovery@hotmail.com",
  password: "recoverypass",
  batchIdentifier: "recovery-batch",
  accountStatus: "ACTIVE",
  jobStatus: "IDLE",
  isEnabled: true,
  recoveryAccount: { set: true }
});
```

### "Failed to authenticate recovery account"

**Causes:**
- Invalid credentials
- Account locked/suspended
- Network issues

**Solution:**
1. Verify credentials are correct
2. Check `accountStatus` of recovery account
3. Manually test login

### OTP timeout

**Causes:**
- Recovery account doesn't have Outlook cookies
- Outlook tokens expired
- Email not arriving

**Solution:**
1. Ensure recovery account has `cookieJar` with Outlook tokens
2. Re-authenticate recovery account: `login(['OUTLOOK'])`
3. Check spam folder in Outlook

### Circular references

**Example:**
- Account A uses Account B as recovery
- Account B uses Account A as recovery
- ❌ Infinite loop!

**Solution:** Run verification script and fix references:
```bash
node verify-database.js circular
```

## Performance Optimization

### 1. Pre-authenticate Recovery Accounts

Before using them, authenticate all recovery accounts to get Outlook tokens:

```javascript
const recoveryAccounts = await RewardsAccountModel.find({
  email: { $in: ['recovery1@...', 'recovery2@...'] }
});

for (const account of recoveryAccounts) {
  const auth = new MicrosoftAuth(
    { email: account.email, password: account.password }
  );

  const result = await auth.login(['ALL', 'OUTLOOK']);

  await RewardsAccountModel.updateOne(
    { _id: account._id },
    { cookieJar: result.cookieJar }
  );
}
```

### 2. Reuse Recovery Accounts

One recovery account can be used by multiple main accounts:

```javascript
// recovery@hotmail.com used by:
// - main1@hotmail.com
// - main2@hotmail.com
// - main3@hotmail.com
// All share the same recovery account
```

### 3. Session Caching

The worker automatically:
- Checks if recovery account has valid cookies
- Reuses existing session if valid
- Only re-authenticates if session expired

## Security Considerations

1. **Protect recovery account credentials** - These are high-value targets
2. **Monitor recovery account activity** - Watch for suspicious logins
3. **Rotate passwords regularly** - Especially for recovery accounts
4. **Limit recovery account reuse** - Don't use one recovery for too many accounts
5. **Enable 2FA on recovery accounts** - If possible (may require manual setup)

## Summary

The fixed ALT email system:

✅ Automatically authenticates recovery accounts
✅ Uses Outlook API to fetch OTP codes
✅ Handles the full ALT addition flow
✅ Updates database with new cookies
✅ Supports session reuse for efficiency
✅ Provides detailed logging and error handling

**Key Insight:** The recovery account must exist as a fully authenticated account in the database with Outlook access, allowing the system to automatically fetch OTP codes without manual intervention.
