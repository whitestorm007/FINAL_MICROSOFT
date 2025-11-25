const RewardsAccountModel = require('./model/db');

/**
 * Finds accounts for AUTH task with recovery account cookie aggregation
 * Conditions: Active accounts with (no cookieJar OR recoveryAccount.set is false)
 * @returns {Promise<Array>} Array of accounts ready for AUTH
 */
async function findAuthAccounts() {
  try {
    const accounts = await RewardsAccountModel.aggregate([
      {
        // Stage 1: Match active accounts needing AUTH
        $match: {
          isEnabled: true,
          accountStatus: 'ACTIVE',
          $or: [
            // No cookieJar exists
            { cookieJar: { $exists: false } },
            { cookieJar: null },
            { cookieJar: '' },
            // recoveryAccount.set is false
            { 'recoveryAccount.set': false }
          ]
        }
      },
      {
        // Stage 2: Lookup recovery account's cookieJar if recoveryAccount.set is false
        $lookup: {
          from: 'accounts2s', // MongoDB collection name
          let: { 
            recoveryEmail: '$recoveryAccount.email',
            recoverySet: '$recoveryAccount.set',
            currentCookie: '$cookieJar'
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    // Only lookup if recoveryAccount.set is false
                    { $eq: ['$$recoverySet', false] },
                    // Match the recovery email
                    { $eq: ['$email', '$$recoveryEmail'] },
                    // Recovery account should have a cookieJar
                    { $ne: ['$cookieJar', null] },
                    { $ne: ['$cookieJar', ''] }
                  ]
                }
              }
            },
            {
              $project: {
                cookieJar: 1,
                email: 1
              }
            }
          ],
          as: 'recoveryAccountData'
        }
      },
      {
        // Stage 3: Add computed fields
        $addFields: {
          // Use recovery cookieJar if available, otherwise keep original
          effectiveCookieJar: {
            $cond: {
              if: { 
                $and: [
                  { $eq: ['$recoveryAccount.set', false] },
                  { $gt: [{ $size: '$recoveryAccountData' }, 0] }
                ]
              },
              then: { $arrayElemAt: ['$recoveryAccountData.cookieJar', 0] },
              else: '$cookieJar'
            }
          },
          hasRecoveryCookie: {
            $cond: {
              if: { $gt: [{ $size: '$recoveryAccountData' }, 0] },
              then: true,
              else: false
            }
          }
        }
      },
      {
        // Stage 4: Project final fields
        $project: {
          email: 1,
          password: 1,
          batchIdentifier: 1,
          persona: 1,
          recoveryAccount: 1,
          proxy: 1,
          cookieJar: 1,
          effectiveCookieJar: 1,
          hasRecoveryCookie: 1,
          currentTask: 1,
          accountStatus: 1,
          isEnabled: 1,
          assignedWorkerId: 1,
          createdAt: 1,
          updatedAt: 1
        }
      },
      {
        // Stage 5: Sort by priority
        $sort: {
          hasRecoveryCookie: -1,
          createdAt: 1
        }
      }
    ]);

    return accounts;
  } catch (error) {
    console.error('Error finding AUTH accounts:', error);
    throw error;
  }
}

/**
 * Finds accounts for ALT task
 * Conditions: Active accounts with currentTask = 'ALT'
 * @returns {Promise<Array>} Array of accounts ready for ALT
 */
async function findAltAccounts() {
  try {
    const accounts = await RewardsAccountModel.find({
      isEnabled: true,
      accountStatus: 'ACTIVE',
      currentTask: 'ALT'
    })
    .select('email password batchIdentifier persona recoveryAccount proxy cookieJar currentTask accountStatus assignedWorkerId')
    .sort({ createdAt: 1 })
    .lean();

    return accounts;
  } catch (error) {
    console.error('Error finding ALT accounts:', error);
    throw error;
  }
}

/**
 * Finds accounts for either AUTH or ALT task
 * Priority: AUTH accounts first, then ALT accounts
 * @returns {Promise<Object>} Object with auth and alt accounts
 */
async function findAuthOrAltAccounts() {
  try {
    const [authAccounts, altAccounts] = await Promise.all([
      findAuthAccounts(),
      findAltAccounts()
    ]);

    return {
      authAccounts,
      altAccounts,
      totalCount: authAccounts.length + altAccounts.length,
      hasAuth: authAccounts.length > 0,
      hasAlt: altAccounts.length > 0
    };
  } catch (error) {
    console.error('Error finding AUTH or ALT accounts:', error);
    throw error;
  }
}

/**
 * Get next available account (prioritizes AUTH over ALT)
 * @returns {Promise<Object|null>} Next account to process
 */
async function getNextAccount() {
  try {
    const { authAccounts, altAccounts } = await findAuthOrAltAccounts();
    
    // Prioritize AUTH accounts
    if (authAccounts.length > 0) {
      return {
        account: authAccounts[0],
        taskType: 'AUTH'
      };
    }
    
    // Then ALT accounts
    if (altAccounts.length > 0) {
      return {
        account: altAccounts[0],
        taskType: 'ALT'
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error getting next account:', error);
    throw error;
  }
}

/**
 * Update account after AUTH with recovery cookieJar
 * @param {string} accountId - Account ID
 * @param {string} cookieJar - CookieJar to set
 */
async function completeAuthTask(accountId, cookieJar) {
  try {
    await RewardsAccountModel.findByIdAndUpdate(
      accountId,
      {
        $set: {
          cookieJar: cookieJar,
          'recoveryAccount.set': true,
          currentTask: 'NONE',
          lastSession: new Date()
        }
      },
      { new: true }
    );
  } catch (error) {
    console.error('Error completing AUTH task:', error);
    throw error;
  }
}

/**
 * Update account after ALT task
 * @param {string} accountId - Account ID
 * @param {Object} updateData - Data to update
 */
async function completeAltTask(accountId, updateData = {}) {
  try {
    await RewardsAccountModel.findByIdAndUpdate(
      accountId,
      {
        $set: {
          currentTask: 'NONE',
          lastSession: new Date(),
          ...updateData
        }
      },
      { new: true }
    );
  } catch (error) {
    console.error('Error completing ALT task:', error);
    throw error;
  }
}

// Usage Example
async function processAccounts() {
  const result = await getNextAccount();
  
  if (!result) {
    console.log('No accounts available for processing');
    return;
  }

  const { account, taskType } = result;
  console.log(`Processing ${taskType} for account:`, account.email);
  
  if (taskType === 'AUTH') {
    if (account.hasRecoveryCookie) {
      console.log('Using cookieJar from recovery account:', account.recoveryAccount.email);
      const cookieToUse = account.effectiveCookieJar;
      
      // Perform AUTH and update
      await completeAuthTask(account._id, cookieToUse);
    } else {
      console.log('Performing fresh AUTH');
      // Perform fresh authentication
    }
  } else if (taskType === 'ALT') {
    console.log('Performing ALT task');
    // Perform ALT task
    await completeAltTask(account._id);
  }
}

module.exports = {
  findAuthAccounts,
  findAltAccounts,
  findAuthOrAltAccounts,
  getNextAccount,
  completeAuthTask,
  completeAltTask,
  processAccounts
};