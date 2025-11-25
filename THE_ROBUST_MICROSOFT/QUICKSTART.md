# Quick Start Guide

## Files Created

1. **`auth.js`** - Main worker that processes accounts continuously
2. **`auth-debug.js`** - Debug tool for testing and monitoring
3. **`.env.example`** - Environment variables template
4. **`AUTH_WORKER_GUIDE.md`** - Comprehensive documentation

## Setup (5 minutes)

### 1. Create .env file
```bash
cp .env.example .env
```

Edit `.env` with your MongoDB connection:
```
MONGO_URI=mongodb://localhost:27017/your-database-name
WORKER_ID=worker-1
```

### 2. Install dependencies
```bash
npm install dotenv mongoose
```

### 3. Verify database setup
```bash
# Run full database verification
node verify-database.js

# This will check:
# - Recovery account setup
# - Missing recovery accounts
# - Circular references
# - Recovery account authentication
# - Database indexes
```

**IMPORTANT:** For the ALT email feature to work, recovery accounts must exist as separate documents in the database. See `DATABASE_SETUP.md` for details.

### 4. Test the setup
```bash
# Show what accounts need attention
node auth-debug.js list

# Show statistics
node auth-debug.js stats
```

## Basic Usage

### Start the Worker
```bash
node auth.js
```

This will:
- Connect to MongoDB
- Find accounts with issues
- Process them automatically
- Run every 5 minutes

### Debug Commands

```bash
# See all available commands
node auth-debug.js help

# Show accounts needing attention
node auth-debug.js list

# Test a specific account (won't actually modify it)
node auth-debug.js test user@hotmail.com

# Show database statistics
node auth-debug.js stats

# Show accounts with errors
node auth-debug.js errors

# Reset stuck accounts
node auth-debug.js reset

# Dry run (show what would be processed)
node auth-debug.js dry-run
```

## What Gets Fixed Automatically

The worker automatically handles:

✅ **Missing Cookies** - Performs full login
✅ **Missing ALT Email** - Adds recovery account (if configured)
✅ **Expired Sessions** - Refreshes or re-authenticates
✅ **Auth Errors** - Re-authenticates and updates status

## Account Requirements

For an account to be processed, it must:
- Have `isEnabled: true`
- Have `jobStatus: 'IDLE'`
- Have `accountStatus` in ['ACTIVE', 'MANUAL_REVIEW']
- Have at least one issue (missing cookies, ALT, error, etc.)

## Monitoring

### Watch the logs
The worker outputs detailed logs:
```
[Worker] Found 5 account(s) needing attention
[user@hotmail.com] Starting processing...
[user@hotmail.com] Found 1 issue(s): MISSING_COOKIES
[user@hotmail.com] Performing full login...
[Worker] Cycle complete. Processed: 5, Errors: 0
```

### Check database
```javascript
// MongoDB shell
use microsoft-accounts

// Show running jobs
db.accounts3.find({ jobStatus: 'RUNNING' })

// Show recent errors
db.accounts3.find({ currentTaskError: { $ne: 'None' } })

// Show accounts needing cookies
db.accounts3.find({ cookieJar: null, isEnabled: true })
```

## Common Issues

### Worker not processing accounts?

1. Check if accounts match criteria:
   ```bash
   node auth-debug.js list
   ```

2. Verify configuration:
   ```bash
   node auth-debug.js config
   ```

3. Check for stuck accounts:
   ```bash
   node auth-debug.js reset
   ```

### Accounts stuck in RUNNING?

If worker crashed, reset them:
```bash
node auth-debug.js reset
```

### Need to process specific account?

```bash
node auth-debug.js test user@hotmail.com
```

## Advanced

### Run multiple workers
```bash
# Terminal 1
WORKER_ID=worker-1 node auth.js

# Terminal 2
WORKER_ID=worker-2 node auth.js
```

### Change processing speed

Edit `auth.js` CONFIG section:
```javascript
const CONFIG = {
    PROCESS_INTERVAL: 5 * 60 * 1000,      // Time between cycles
    MAX_ACCOUNTS_PER_CYCLE: 10,           // Accounts per cycle
    ACCOUNT_DELAY: 10 * 1000,             // Delay between accounts
};
```

### Custom processing

```javascript
const { AccountProcessor, DatabaseManager } = require('./auth');

async function custom() {
    await DatabaseManager.connect();
    const processor = new AccountProcessor();
    await processor.processBatch(); // Process one batch
    await DatabaseManager.disconnect();
}
```

## Next Steps

1. ✅ Setup .env file
2. ✅ **Verify database** with `node verify-database.js`
3. ✅ Fix any database issues (see `DATABASE_SETUP.md`)
4. ✅ Test with `node auth-debug.js list`
5. ✅ Start worker with `node auth.js`
6. Monitor logs and database
7. Adjust CONFIG if needed

## Need Help?

See `AUTH_WORKER_GUIDE.md` for detailed documentation.

## Production Deployment

For production use:

1. Use process manager (PM2):
   ```bash
   npm install -g pm2
   pm2 start auth.js --name "auth-worker"
   pm2 logs auth-worker
   pm2 stop auth-worker
   ```

2. Add to systemd/init.d for auto-restart

3. Set up monitoring and alerts

4. Regular database backups

5. Monitor rate limiting
