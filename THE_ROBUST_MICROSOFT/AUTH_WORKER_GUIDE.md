# Microsoft Auth Worker Guide

## Overview

The `auth.js` worker continuously monitors your Microsoft accounts database and fixes authentication issues automatically.

## Features

- **Automatic Login**: Logs in accounts missing cookie jars
- **Alternative Email Management**: Adds ALT emails to accounts older than 7 days
- **Session Refresh**: Keeps sessions alive by refreshing expired ones
- **Error Recovery**: Re-authenticates accounts with auth errors
- **Status Tracking**: Updates account status in real-time

## Setup

1. **Install Dependencies**
   ```bash
   npm install dotenv mongoose
   ```

2. **Configure Environment**
   Copy `.env.example` to `.env` and update with your settings:
   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   ```
   MONGO_URI=mongodb://localhost:27017/microsoft-accounts
   WORKER_ID=worker-1
   ```

3. **Run the Worker**
   ```bash
   node auth.js
   ```

## How It Works

### Account Detection

The worker identifies "bad" accounts based on:

1. **Missing Cookies** - Accounts without a valid `cookieJar`
2. **Missing ALT Email** - Accounts older than 7 days without recovery account
3. **Auth Errors** - Accounts with `currentTaskError` != 'None'
4. **Expired Sessions** - Accounts past their `nextSessionEligible` date

### Processing Priority

Issues are processed in this order:
1. Missing cookies (FULL_LOGIN)
2. Missing ALT email (ADD_ALT)
3. Auth errors (RE_AUTH)
4. Expired sessions (REFRESH_SESSION)

### Actions Performed

#### FULL_LOGIN
- Performs complete authentication
- Gets all cookies (Bing, Rewards, Outlook)
- Updates `cookieJar` in database
- Sets `nextSessionEligible` to +24 hours

#### ADD_ALT
- Ensures session is valid
- Calls `auth.Alt()` to add alternative email
- Marks `recoveryAccount.set` as true
- Updates cookies

#### RE_AUTH
- Re-authenticates with existing cookies
- Handles special states (locked, needs ALT)
- Updates account status accordingly

#### REFRESH_SESSION
- Verifies existing session
- Falls back to FULL_LOGIN if invalid

### Database Updates

The worker updates these fields:

**During Processing:**
- `jobStatus`: 'RUNNING'
- `assignedWorkerId`: Worker ID
- `jobMessage`: Current operation

**On Success:**
- `jobStatus`: 'IDLE'
- `cookieJar`: Updated cookies
- `currentTask`: 'NONE'
- `currentTaskError`: 'None'
- `lastSession`: Current timestamp
- `nextSessionEligible`: +24 hours

**On Failure:**
- `jobStatus`: 'IDLE'
- `currentTaskError`: Error message
- `accountStatus`: May change to 'LOCKED' or 'SUSPENDED'
- `currentTask`: May change to 'ALT' or 'RE_AUTH'

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URI` | `mongodb://localhost:27017/microsoft-accounts` | MongoDB connection string |
| `WORKER_ID` | `worker-{pid}` | Unique worker identifier |

### Constants (in auth.js)

```javascript
const CONFIG = {
    PROCESS_INTERVAL: 5 * 60 * 1000,      // 5 minutes
    MAX_ACCOUNTS_PER_CYCLE: 10,           // Max accounts per cycle
    ACCOUNT_DELAY: 10 * 1000,             // 10 seconds between accounts
    ALT_REQUIRED_DAYS: 7                  // Days before ALT required
};
```

## Running Multiple Workers

You can run multiple workers simultaneously:

```bash
# Terminal 1
WORKER_ID=worker-1 node auth.js

# Terminal 2
WORKER_ID=worker-2 node auth.js

# Terminal 3
WORKER_ID=worker-3 node auth.js
```

Workers coordinate through the database using `assignedWorkerId` to prevent duplicate processing.

## Monitoring

### Console Output

The worker logs:
- Connection status
- Accounts found per cycle
- Processing details per account
- Success/failure counts
- Next cycle countdown

Example:
```
[worker-1] Found 5 account(s) needing attention
[user@hotmail.com] Starting processing...
[user@hotmail.com] Found 1 issue(s): MISSING_COOKIES
[user@hotmail.com] Performing full login...
[user@hotmail.com] Login successful!
[Worker] Cycle complete. Processed: 5, Errors: 0
[Worker] Waiting 300s until next cycle...
```

### Database Monitoring

Query accounts being processed:
```javascript
db.accounts3.find({ jobStatus: 'RUNNING' })
```

Query recent errors:
```javascript
db.accounts3.find({
    currentTaskError: { $ne: 'None' }
}).sort({ updatedAt: -1 })
```

Query accounts needing attention:
```javascript
db.accounts3.find({
    isEnabled: true,
    $or: [
        { cookieJar: null },
        { 'recoveryAccount.set': { $ne: true } }
    ]
})
```

## Graceful Shutdown

Press `Ctrl+C` to stop the worker gracefully:
```
^C
[Main] Received SIGINT, shutting down...
[Worker] Stopping...
[DB] Disconnected from MongoDB
```

## Error Handling

### Account Locked
- Sets `accountStatus: 'LOCKED'`
- Stops processing that account
- Manual intervention required

### Invalid Credentials
- Sets `accountStatus: 'SUSPENDED'`
- Indicates bad email/password
- Check credentials in database

### Need ALT Email
- Sets `currentTask: 'ALT'`
- Will retry on next cycle
- Ensure recovery account configured

### Re-auth Needed
- Sets `currentTask: 'RE_AUTH'`
- Requires additional verification
- May need manual intervention

## Troubleshooting

### No Accounts Being Processed

Check:
1. Are there accounts matching the query criteria?
2. Is `isEnabled: true`?
3. Is `jobStatus: 'IDLE'`?
4. Is `accountStatus` in ['ACTIVE', 'MANUAL_REVIEW']?

### Accounts Stuck in RUNNING

If a worker crashes, accounts may remain in RUNNING state. Reset them:

```javascript
db.accounts3.updateMany(
    { jobStatus: 'RUNNING' },
    {
        $set: {
            jobStatus: 'IDLE',
            assignedWorkerId: null,
            jobMessage: 'Reset by admin'
        }
    }
)
```

### Rate Limiting

If you see rate limiting errors:
1. Increase `ACCOUNT_DELAY` in CONFIG
2. Reduce `MAX_ACCOUNTS_PER_CYCLE`
3. Increase `PROCESS_INTERVAL`

### Connection Issues

If MongoDB connection fails:
1. Check `MONGO_URI` in `.env`
2. Ensure MongoDB is running
3. Check network connectivity
4. Verify credentials

## Advanced Usage

### Custom Processing Logic

You can import and use the processor programmatically:

```javascript
const { AccountProcessor, DatabaseManager } = require('./auth.js');

async function customProcess() {
    await DatabaseManager.connect();

    const processor = new AccountProcessor();

    // Process just one batch
    await processor.processBatch();

    await DatabaseManager.disconnect();
}

customProcess();
```

### Single Account Processing

```javascript
const account = await RewardsAccountModel.findOne({ email: 'user@hotmail.com' });
const processor = new AccountProcessor();
const result = await processor.processAccount(account);
console.log(result);
```

## Best Practices

1. **Start Small**: Begin with 1 worker and low account limits
2. **Monitor Logs**: Watch for patterns in errors
3. **Database Backups**: Regular backups before mass processing
4. **Rate Limiting**: Respect Microsoft's rate limits
5. **Error Review**: Regularly check accounts with errors
6. **Session Timing**: Adjust intervals based on your needs

## Security Notes

- Keep `.env` file secure (never commit to git)
- Use strong MongoDB authentication
- Run worker in secure environment
- Monitor for suspicious activity
- Rotate credentials regularly

## Support

For issues or questions about the worker, check:
1. Database connection
2. Account credentials
3. Network connectivity
4. Microsoft service status
