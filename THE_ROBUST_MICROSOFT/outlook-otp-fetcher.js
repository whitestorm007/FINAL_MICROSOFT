const axios = require('axios');

/**
 * Enhanced OutlookOTPFetcher - Ultra-robust OTP extraction with startup data fallback
 */
class OutlookOTPFetcher {
    constructor(accessToken, mailboxValue) {
        this.accessToken = accessToken;
        this.mailboxValue = mailboxValue;
        this.baseHeaders = {
            'Host': 'outlook.live.com',
            'X-Req-Source': 'Mail',
            'Authorization': `MSAuth1.0 usertoken="${accessToken}", type="MSACT"`,
            'X-Anchormailbox': `PUID:${mailboxValue}`,
            'X-Owa-Hosted-Ux': 'false',
            'Prefer': 'IdType="ImmutableId", exchange.behavior="IncludeThirdPartyOnlineMeetingProviders"',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Content-Type': 'application/json; charset=utf-8',
            'Accept': '*/*',
            'Origin': 'https://outlook.live.com',
            'Cookie': 'a=a;'
        };
        this.folderCache = null;
        this.folderCacheTime = null;
        this.FOLDER_CACHE_DURATION = 300000; // 5 minutes
    }

    /**
     * Enhanced OTP extraction with comprehensive pattern matching
     */
    extractOTPFromPreview(preview) {
        if (!preview) return null;

        // Clean the preview text - handle Windows line endings
        const cleanText = preview
            .replace(/\r\n/g, ' ')
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        console.log("Attempting OTP extraction from:", cleanText.substring(0, 150));

        // Comprehensive pattern list - ordered by specificity
        const patterns = [
            // Microsoft-specific patterns with various formats
            /Security code:\s*(\d{4,8})/i,
            /security code\s+(\d{4,8})/i,
            /Security code\s+is\s+(\d{4,8})/i,
            
            // Verification patterns
            /verification code:\s*(\d{4,8})/i,
            /verification code\s+(\d{4,8})/i,
            /verify.*?code:\s*(\d{4,8})/i,
            
            // Generic code patterns
            /Your code:\s*(\d{4,8})/i,
            /your code\s+(\d{4,8})/i,
            /code is:\s*(\d{4,8})/i,
            /code is\s+(\d{4,8})/i,
            /code:\s*(\d{4,8})/i,
            
            // One-time patterns
            /One-time code:\s*(\d{4,8})/i,
            /one-time code\s+(\d{4,8})/i,
            /OTP:\s*(\d{4,8})/i,
            /OTP\s+(\d{4,8})/i,
            
            // Passcode patterns
            /passcode:\s*(\d{4,8})/i,
            /passcode\s+(\d{4,8})/i,
            /pass code:\s*(\d{4,8})/i,
            
            // Pattern with "use" keyword (common in MS emails)
            /use\s+(?:the\s+)?(?:following\s+)?(?:security\s+)?code[:\s]+(\d{4,8})/i,
            /please\s+use.*?code[:\s]+(\d{4,8})/i,
            
            // Access code patterns
            /access code:\s*(\d{4,8})/i,
            /access code\s+(\d{4,8})/i,
            
            // Standalone 6-digit number (most common OTP length)
            /\b(\d{6})\b/,
            
            // 4-8 digit codes with word boundaries
            /\b(\d{5})\b/,
            /\b(\d{7})\b/,
            /\b(\d{8})\b/,
            /\b(\d{4})\b/,
            
            // Codes in brackets or parentheses
            /\[(\d{4,8})\]/,
            /\((\d{4,8})\)/,
            /\{(\d{4,8})\}/,
            
            // Multi-language support
            /código:\s*(\d{4,8})/i,        // Spanish
            /code:\s*(\d{4,8})/i,          // French
            /код:\s*(\d{4,8})/i,           // Russian
            /代码:\s*(\d{4,8})/,            // Chinese
            /コード:\s*(\d{4,8})/,          // Japanese
            /codice:\s*(\d{4,8})/i,        // Italian
            /Kode:\s*(\d{4,8})/i           // German/Norwegian
        ];

        // Try each pattern
        for (const pattern of patterns) {
            const match = cleanText.match(pattern);
            if (match && match[1]) {
                const code = match[1];
                // Validate it's a reasonable OTP (4-8 digits)
                if (code.length >= 4 && code.length <= 8) {
                    console.log(`✓ OTP found using pattern: ${pattern.source}`);
                    console.log(`✓ Extracted OTP: ${code}`);
                    return code;
                }
            }
        }

        console.log("✗ No OTP pattern matched");
        return null;
    }

    /**
     * Direct extraction from startup data - FASTEST METHOD
     * This extracts OTP directly from the initial response without additional API calls
     */
    extractOTPFromStartupData(startupData) {
        try {
            console.log("Attempting direct OTP extraction from startup data...");

            // Navigate through possible response structures
            let conversations = null;

            if (startupData?.findConversation?.Body?.Conversations) {
                conversations = startupData.findConversation.Body.Conversations;
            } else if (startupData?.Body?.Conversations) {
                conversations = startupData.Body.Conversations;
            } else if (startupData?.FindConversation?.Body?.Conversations) {
                conversations = startupData.FindConversation.Body.Conversations;
            }

            if (!conversations || !Array.isArray(conversations)) {
                console.log("No conversations found in startup data");
                return null;
            }

            console.log(`Found ${conversations.length} conversations in startup data`);

            // Filter for security-related emails
            const now = Date.now();
            const maxAge = 600000; // 10 minutes

            const securityEmails = conversations.filter(conv => {
                // Check subject
                const subject = (conv.ConversationTopic || '').toLowerCase();
                const hasSecuritySubject = subject.includes('security code') ||
                    subject.includes('verification code') ||
                    subject.includes('security info') ||
                    subject.includes('verify');

                // Check sender
                const sender = (conv.LastSender?.Mailbox?.EmailAddress || '').toLowerCase();
                const isMicrosoft = sender.includes('microsoft') ||
                    sender.includes('accountprotection') ||
                    sender.includes('account-security');

                // Check age
                let isRecent = true;
                if (conv.LastDeliveryTime) {
                    const deliveryTime = new Date(conv.LastDeliveryTime).getTime();
                    const age = now - deliveryTime;
                    isRecent = age <= maxAge;
                    
                    // Debug logging
                    if (!isRecent) {
                        console.log(`  ✗ Email too old: "${conv.ConversationTopic}" (${Math.round(age/1000)}s old, max ${maxAge/1000}s)`);
                    }
                } else {
                    console.log(`  ⚠ No delivery time for: "${conv.ConversationTopic}"`);
                }

                // Debug logging for failed filters
                if (!hasSecuritySubject) {
                    console.log(`  ✗ Subject doesn't match: "${conv.ConversationTopic}"`);
                }
                if (!isMicrosoft) {
                    console.log(`  ✗ Sender not Microsoft: ${sender}`);
                }

                return hasSecuritySubject && isMicrosoft && isRecent;
            });

            console.log(`Found ${securityEmails.length} security-related emails`);

            // Sort by most recent
            securityEmails.sort((a, b) => {
                const timeA = new Date(a.LastDeliveryTime || 0).getTime();
                const timeB = new Date(b.LastDeliveryTime || 0).getTime();
                return timeB - timeA;
            });

            // Try to extract OTP from each email's preview
            for (const email of securityEmails) {
                if (email.Preview) {
                    console.log(`Checking email: ${email.ConversationTopic}`);
                    console.log(`Preview snippet: ${email.Preview.substring(0, 100)}...`);

                    const otp = this.extractOTPFromPreview(email.Preview);
                    if (otp) {
                        return {
                            success: true,
                            otp,
                            email: {
                                subject: email.ConversationTopic,
                                sender: email.LastSender?.Mailbox?.EmailAddress,
                                deliveryTime: email.LastDeliveryTime,
                                preview: email.Preview.substring(0, 200)
                            },
                            method: 'startup_data_direct'
                        };
                    }
                }
            }

            console.log("No OTP found in startup data conversations");
            return null;

        } catch (error) {
            console.log("Error extracting from startup data:", error.message);
            return null;
        }
    }

    /**
     * Get folder IDs with enhanced error handling
     */
    async getFolderIds() {
        console.log("Fetching folder IDs...");

        // Check cache first
        if (this.folderCache && this.folderCacheTime) {
            const cacheAge = Date.now() - this.folderCacheTime;
            if (cacheAge < this.FOLDER_CACHE_DURATION) {
                console.log("Using cached folder IDs");
                return this.folderCache;
            }
        }

        try {
            const response = await axios.post(
                'https://outlook.live.com/owa/0/startupdata.ashx',
                {},
                {
                    headers: {
                        ...this.baseHeaders,
                        'Action': 'FindConversation'
                    },
                    timeout: 15000
                }
            );

            // Try direct OTP extraction first (fastest path!)
            const directResult = this.extractOTPFromStartupData(response.data);
            if (directResult && directResult.success) {
                console.log("✓ OTP extracted directly from startup data!");
                // Store this for immediate return
                this.directOTPResult = directResult;
            }

            // Extract folder IDs from various possible structures
            let searchFolderId, folderId;

            if (response.data?.findConversation?.Body) {
                const body = response.data.findConversation.Body;
                if (body.SearchFolderId?.Id && body.FolderId?.Id) {
                    searchFolderId = body.SearchFolderId.Id;
                    folderId = body.FolderId.Id;
                } else if (body.FolderId?.Id) {
                    // Use FolderId for both if SearchFolderId is missing
                    folderId = body.FolderId.Id;
                    searchFolderId = body.FolderId.Id;
                }
            }

            if (!searchFolderId && response.data?.Body?.FolderId?.Id) {
                folderId = response.data.Body.FolderId.Id;
                searchFolderId = response.data.Body.FolderId.Id;
            }

            if (searchFolderId && folderId) {
                this.folderCache = { searchFolderId, folderId };
                this.folderCacheTime = Date.now();
                return this.folderCache;
            }

            // Fallback methods
            console.log("Trying fallback folder ID methods...");
            const folderIds = await this.getFolderIdsFromInbox();
            if (folderIds) {
                this.folderCache = folderIds;
                this.folderCacheTime = Date.now();
                return folderIds;
            }

            return null;

        } catch (error) {
            console.log("Error getting folder IDs:", error.message);
            return null;
        }
    }

    /**
     * Fallback method: Get folder IDs from inbox
     */
    async getFolderIdsFromInbox() {
        try {
            const payload = {
                "__type": "GetFolderRequest:#Exchange",
                "Header": {
                    "__type": "JsonRequestHeaders:#Exchange",
                    "RequestServerVersion": "V2018_01_08"
                },
                "Body": {
                    "FolderIds": [{
                        "__type": "DistinguishedFolderId:#Exchange",
                        "Id": "inbox"
                    }],
                    "FolderShape": {
                        "__type": "FolderResponseShape:#Exchange",
                        "BaseShape": "IdOnly"
                    }
                }
            };

            const response = await axios.post(
                'https://outlook.live.com/owa/0/service.svc?action=GetFolder',
                {},
                {
                    headers: {
                        ...this.baseHeaders,
                        'Action': 'GetFolder',
                        'X-Owa-Urlpostdata': JSON.stringify(payload)
                    },
                    timeout: 10000
                }
            );

            if (response.data?.Body?.ResponseMessages?.Items?.[0]?.Folders?.[0]?.FolderId?.Id) {
                const inboxId = response.data.Body.ResponseMessages.Items[0].Folders[0].FolderId.Id;
                return { searchFolderId: inboxId, folderId: inboxId };
            }

            return null;
        } catch (error) {
            console.log("Inbox method failed:", error.message);
            return null;
        }
    }

    /**
     * Enhanced findMicrosoftOTP with startup data fallback
     */
    async findMicrosoftOTP(options = {}) {
        console.log("Searching for Microsoft OTP...");

        const {
            maxAge = 600000, // 10 minutes (increased from 5)
            senderFilters = [
                'account-security-noreply@accountprotection.microsoft.com',
                'noreply@microsoft.com',
                'microsoft-noreply@microsoft.com'
            ],
            subjectFilters = [
                'security code',
                'verification code',
                'verify',
                'security info'
            ]
        } = options;

        try {
            // First, try to get folder IDs (this will also attempt direct extraction)
            const folderIds = await this.getFolderIds();

            // Check if we got a direct OTP result from startup data
            if (this.directOTPResult) {
                console.log("✓ Using OTP from startup data (fastest path)");
                const result = this.directOTPResult;
                this.directOTPResult = null; // Clear it
                return result;
            }

            // If no folder IDs and no direct result, we can't proceed
            if (!folderIds) {
                return {
                    success: false,
                    error: 'Could not obtain folder IDs and no OTP found in startup data'
                };
            }

            // Try standard conversation fetch (this might fail with 500, which is okay)
            try {
                const conversations = await this.getConversationsSimplified(15);

                if (conversations && conversations.length > 0) {
                    const now = Date.now();
                    const recentEmails = conversations
                        .filter(conv => {
                            const sender = (conv.LastSender?.Mailbox?.EmailAddress || '').toLowerCase();
                            const subject = (conv.ConversationTopic || '').toLowerCase();

                            const senderMatches = senderFilters.some(filter =>
                                sender.includes(filter.toLowerCase())
                            ) || sender.includes('microsoft');

                            const subjectMatches = subjectFilters.some(filter =>
                                subject.includes(filter.toLowerCase())
                            );

                            let isRecent = true;
                            if (conv.LastDeliveryTime) {
                                const deliveryTime = new Date(conv.LastDeliveryTime).getTime();
                                const age = now - deliveryTime;
                                isRecent = age <= maxAge;
                            }

                            return senderMatches && subjectMatches && isRecent;
                        })
                        .sort((a, b) => new Date(b.LastDeliveryTime) - new Date(a.LastDeliveryTime));

                    for (const email of recentEmails) {
                        if (email.Preview) {
                            const otp = this.extractOTPFromPreview(email.Preview);
                            if (otp) {
                                return {
                                    success: true,
                                    otp,
                                    email: {
                                        subject: email.ConversationTopic,
                                        sender: email.LastSender?.Mailbox?.EmailAddress,
                                        deliveryTime: email.LastDeliveryTime,
                                        preview: email.Preview.substring(0, 200)
                                    },
                                    method: 'conversation_api'
                                };
                            }
                        }
                    }
                }
            } catch (convError) {
                console.log("Conversation fetch failed (expected):", convError.message);
            }

            return {
                success: false,
                error: 'No OTP found in available emails'
            };

        } catch (error) {
            console.error("Error in findMicrosoftOTP:", error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Simplified conversation fetching
     */
    async getConversationsSimplified(maxEntries = 15) {
        try {
            const payload = {
                "__type": "FindConversationJsonRequest:#Exchange",
                "Header": {
                    "__type": "JsonRequestHeaders:#Exchange",
                    "RequestServerVersion": "V2018_01_08"
                },
                "Body": {
                    "ParentFolderId": {
                        "__type": "DistinguishedFolderId:#Exchange",
                        "Id": "inbox"
                    },
                    "ConversationShape": {
                        "__type": "ConversationResponseShape:#Exchange",
                        "BaseShape": "IdOnly"
                    },
                    "ShapeName": "ReactConversationListView",
                    "Paging": {
                        "__type": "IndexedPageView:#Exchange",
                        "BasePoint": "Beginning",
                        "Offset": 0,
                        "MaxEntriesReturned": maxEntries
                    },
                    "ViewFilter": "All",
                    "SortOrder": [{
                        "__type": "SortResults:#Exchange",
                        "Order": "Descending",
                        "Path": {
                            "__type": "PropertyUri:#Exchange",
                            "FieldURI": "ConversationLastDeliveryTime"
                        }
                    }]
                }
            };

            const response = await axios.post(
                'https://outlook.live.com/owa/0/service.svc?action=FindConversation',
                {},
                {
                    headers: {
                        ...this.baseHeaders,
                        'Action': 'FindConversation',
                        'X-Owa-Urlpostdata': JSON.stringify(payload)
                    },
                    timeout: 15000
                }
            );

            return response.data?.Body?.Conversations || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Wait for OTP with enhanced retry logic - ALWAYS fetches fresh data
     */
    async waitForOTP(options = {}) {
        console.log("Waiting for OTP email...");

        const {
            timeout = 120000,
            pollInterval = 5000,
            initialDelay = 2000,
            ...otpOptions
        } = options;

        // Smaller initial delay since startup data is fast
        if (initialDelay > 0) {
            console.log(`Initial delay: ${initialDelay}ms`);
            await this.sleep(initialDelay);
        }

        const startTime = Date.now();
        let attempts = 0;

        while (Date.now() - startTime < timeout) {
            attempts++;
            console.log(`\n=== Poll attempt ${attempts} at ${new Date().toISOString()} ===`);

            // CRITICAL: Clear cache before each poll to force fresh data
            this.clearCache();
            console.log("Cache cleared - will fetch fresh startup data");

            const result = await this.findMicrosoftOTP(otpOptions);

            if (result.success) {
                console.log(`\n✓✓✓ SUCCESS! OTP found after ${attempts} attempts ✓✓✓`);
                console.log(`Method used: ${result.method}`);
                console.log(`OTP: ${result.otp}`);
                return result;
            }

            const remainingTime = timeout - (Date.now() - startTime);
            const nextWait = Math.min(pollInterval, remainingTime);

            if (nextWait > 0) {
                console.log(`Waiting ${nextWait}ms before next check...`);
                await this.sleep(nextWait);
            }
        }

        return {
            success: false,
            error: `Timeout after ${attempts} attempts`
        };
    }

    /**
     * Test connection
     */
    async testConnection() {
        try {
            console.log("Testing connection...");
            const folderIds = await this.getFolderIds();

            if (this.directOTPResult) {
                return {
                    success: true,
                    message: 'Connection successful and OTP found in startup data!',
                    otp: this.directOTPResult
                };
            }

            if (folderIds) {
                return {
                    success: true,
                    message: 'Connection successful',
                    folderIds
                };
            }

            return {
                success: false,
                message: 'Could not retrieve folder data'
            };
        } catch (error) {
            return {
                success: false,
                message: `Connection test failed: ${error.message}`
            };
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    clearCache() {
        this.folderCache = null;
        this.folderCacheTime = null;
        this.directOTPResult = null;
        console.log("Cache cleared");
    }
}

/**
 * Helper functions
 */
function createOTPFetcherFromCookieJar(cookieJarString) {
    console.log("Creating OTP fetcher from cookie jar...");

    let data;
    try {
        data = typeof cookieJarString === 'string' ? JSON.parse(cookieJarString) : cookieJarString;
    } catch (error) {
        throw new Error(`Invalid cookie jar format: ${error.message}`);
    }

    const tokens = data.metadata?.outlookTokens;
    const mailbox = data.metadata?.mailboxValue;

    if (!tokens?.access_token || !mailbox) {
        throw new Error('Missing Outlook tokens or mailbox value in cookie jar');
    }

    return new OutlookOTPFetcher(tokens.access_token, mailbox);
}

function createOTPFetcherFromSession(session) {
    const tokens = session.getMetadata('outlookTokens');
    const mailbox = session.getMetadata('mailboxValue');

    if (!tokens?.access_token || !mailbox) {
        throw new Error('Missing Outlook tokens or mailbox value in session');
    }

    return new OutlookOTPFetcher(tokens.access_token, mailbox);
}

module.exports = {
    OutlookOTPFetcher,
    createOTPFetcherFromSession,
    createOTPFetcherFromCookieJar
};

/* 
USAGE EXAMPLE:

const fetcher = createOTPFetcherFromCookieJar(cookieJarData);

// Fastest method - usually gets OTP on first call
const result = await fetcher.waitForOTP({
    timeout: 120000,
    pollInterval: 5000,
    initialDelay: 2000,
    maxAge: 600000  // Accept emails up to 10 minutes old
});

if (result.success) {
    console.log('OTP:', result.otp);
    console.log('Method:', result.method); // 'startup_data_direct' or 'conversation_api'
}
*/