const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs")
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const FormData = require('form-data');
const createMicrosoftAuthUrl = require("./decode");
const { HeaderGenerator } = require("header-generator");
// const Accounts = require("../model/db")
const { EnhancedRedirectHandler } = require('./integrated-auth');

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================




const AuthState = {
    KMSI_PAGE_OK: 'KMSI_PAGE_OK',
    INITIAL_PAGE_OK: 'INITIAL_PAGE_OK',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
    REAUTH_NEEDED: 'REAUTH_NEEDED',
    UNKNOWN_STATE: 'UNKNOWN_STATE',
    PASSKEY_INTERRUPT: 'PASSKEY_INTERRUPT',
    PRIVACY_NOTICE: 'PRIVACY_NOTICE',
    AUTO_SUBMIT_FORM_DETECTED: "AUTO_SUBMIT_FORM_DETECTED",
    MANUAL_REDIRECT_DETECTED: "MANUAL_REDIRECT_DETECTED",
    NEED_TO_ADD_ALT: "NEED_TO_ADD_ALT",
    MICROSOFT_HOME_PAGE: "MICROSOFT_HOME_PAGE",
    MICROSOFT_UPDATE_TERM: "MICROSOFT_UPDATE_TERM"
};

const BROWSER_PROFILE = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
};

const BASE_URLS = {
    LOGIN: "https://login.live.com/",
    REWARDS: "https://rewards.bing.com/Signin?idru=%2F",
    OUTLOOK: "https://outlook.live.com/owa/",
    OUTLOOK2: "https://outlook.com",
    ACCOUNT: "https://account.microsoft.com/",
    BING: "https://www.bing.com/",
    ALT: "https://account.live.com/proofs/Add",
    TENANT_ID_VALUE: "84df9e7f-e9f6-40af-b435-aaaaaaaaaaaa"
};

// ============================================================================
// CUSTOM ERROR CLASS
// ============================================================================

class AuthError extends Error {
    constructor(message, step, details = null) {
        super(message);
        this.name = 'AuthError';
        this.step = step;
        this.details = details;
    }
}

// ============================================================================
// HTTP SESSION MANAGER WITH METADATA STORAGE
// ============================================================================

class HttpSession {
    constructor(proxy = null, cookieJar = null) {
        this.jar = cookieJar || new CookieJar();
        this.client = this._createClient(proxy);
        this.flowToken = null;
        this.loginUrl = BASE_URLS.LOGIN;

        // Initialize metadata storage on the jar if it doesn't exist
        if (!this.jar._metadata) {
            this.jar._metadata = {};
        }
    }

    _createClient(proxy) {
        const config = {
            jar: this.jar,
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
            headers: BROWSER_PROFILE
        };

        if (proxy) {
            config.proxy = {
                host: proxy.host,
                port: proxy.port,
                auth: { username: proxy.username, password: proxy.password }
            };
        }

        return wrapper(axios.create(config));
    }

    async getCookiesForDomain(domain) {
        try {
            const cookies = await this.jar.getCookies(domain);
            return cookies.map(c => ({ name: c.key, value: c.value }));
        } catch (err) {
            console.error(`Error reading cookies for ${domain}:`, err);
            return [];
        }
    }

    // ========================================================================
    // METADATA STORAGE METHODS
    // ========================================================================

    /**
     * Set custom metadata in the cookie jar
     * @param {string} key - Metadata key (e.g., 'outlookTokens', 'mailboxValue')
     * @param {any} value - Value to store (will be JSON serialized)
     */
    setMetadata(key, value) {
        if (!this.jar._metadata) {
            this.jar._metadata = {};
        }
        this.jar._metadata[key] = value;
    }

    /**
     * Get custom metadata from the cookie jar
     * @param {string} key - Metadata key
     * @returns {any} Stored value or null if not found
     */
    getMetadata(key) {
        return this.jar._metadata?.[key] || null;
    }

    /**
     * Check if metadata exists
     * @param {string} key - Metadata key
     * @returns {boolean}
     */
    hasMetadata(key) {
        return this.jar._metadata && key in this.jar._metadata;
    }

    /**
     * Remove metadata
     * @param {string} key - Metadata key
     */
    removeMetadata(key) {
        if (this.jar._metadata) {
            delete this.jar._metadata[key];
        }
    }

    /**
     * Get all metadata
     * @returns {object}
     */
    getAllMetadata() {
        return this.jar._metadata || {};
    }

    // ========================================================================
    // EXPORT/IMPORT WITH METADATA
    // ========================================================================

    /**
     * Export cookie jar with metadata
     * @returns {string} JSON string containing cookies and metadata
     */
    exportCookieJar() {
        const jarData = this.jar.toJSON();

        // Add metadata to the export
        return JSON.stringify({
            cookies: jarData,
            metadata: this.jar._metadata || {},
            exportedAt: new Date().toISOString()
        });
    }

    /**
     * Import cookie jar with metadata
     * @param {string} cookieJarString - JSON string from exportCookieJar()
     * @returns {CookieJar|null}
     */
    static importCookieJar(cookieJarString) {
        try {
            const data = JSON.parse(cookieJarString);

            // Handle old format (direct cookie jar) and new format (with metadata)
            let cookieData, metadata;

            if (data.cookies && data.metadata) {
                // New format with metadata
                cookieData = data.cookies;
                metadata = data.metadata;
            } else {
                // Old format - just cookies
                cookieData = data;
                metadata = {};
            }

            const jar = CookieJar.fromJSON(cookieData);
            jar._metadata = metadata;

            return jar;
        } catch (err) {
            console.error('Failed to parse cookie jar:', err);
            return null;
        }
    }
}

// ============================================================================
// HTML PARSER UTILITIES
// ============================================================================

class HtmlParser {
    static extractServerData(html) {
        const regex = /var ServerData\s*=\s*({.*?});/s;
        const match = html.match(regex);
        if (match && match[1]) {
            try {
                return JSON.parse(match[1]);
            } catch {
                return null;
            }
        }
        return null;
    }

    static extractFlowToken(serverData) {
        if (!serverData || !serverData.sFTTag) return null;
        const $ = cheerio.load(serverData.sFTTag);
        return $('input[name="PPFT"]').val();
    }

    static extractUcisData(html) {
        if (!html) return null;

        try {
            const $ = cheerio.load(html);
            const scriptTag = $('script:contains("var ucis = ucis || {};")');
            if (scriptTag.length === 0) return null;

            const scriptText = scriptTag.html();
            const ucisData = {};

            // Extract string values
            const stringRegex = /ucis\.(\w+)\s*=\s*'(.*?)'/g;
            let match;
            while ((match = stringRegex.exec(scriptText)) !== null) {
                ucisData[match[1]] = match[2];
            }

            // Extract SerializedEncryptionData
            const jsonRegex = /ucis\.SerializedEncryptionData\s*=\s*'(.*?)'/;
            const jsonMatch = scriptText.match(jsonRegex);
            if (jsonMatch && jsonMatch[1]) {
                ucisData.SerializedEncryptionData = jsonMatch[1];
            }

            return ucisData.ClientId && ucisData.SerializedEncryptionData ? ucisData : null;
        } catch (error) {
            console.error("Error parsing UCIS data:", error);
            return null;
        }
    }

    static extractMailboxCookie(headers) {
        const setCookieHeader = headers['set-cookie'];
        if (!setCookieHeader || !Array.isArray(setCookieHeader)) return null;

        const cookieString = setCookieHeader.find(c => c.startsWith('DefaultAnchorMailbox='));
        if (!cookieString) return null;

        try {
            const valuePart = cookieString.split('=')[1];
            const value = valuePart.split(';')[0];
            return decodeURIComponent(value);
        } catch {
            return null;
        }
    }
}

// ============================================================================
// RESPONSE ANALYZER
// ============================================================================

class ResponseAnalyzer {
    constructor(responce) {
        this.responce = responce
        this.html = responce.data;
        this.$ = cheerio.load(this.html);
        this.serverData = HtmlParser.extractServerData(this.html);
    }

    getAuthState() {
        // Check for error states
        if (this.responce.status == 302 && this.responce.headers.location.includes("account.live.com")) {
            console.log(this.responce.headers);
            return AuthState.MICROSOFT_HOME_PAGE;
        }
        if (this.serverData?.sErrTxt?.includes('incorrect')) {
            return AuthState.INVALID_CREDENTIALS;
        }
        if (this.html.includes('/Abuse')) {
            return AuthState.ACCOUNT_LOCKED;
        }
        if (this.html.includes('identity/confirm')) {
            return AuthState.REAUTH_NEEDED;
        }
        if (this.html.includes('interrupt/passkey')) {
            return AuthState.PASSKEY_INTERRUPT;
        }
        if (this.html.includes('proofs/Add')) {
            return AuthState.NEED_TO_ADD_ALT;
        }


        if (this.html.includes('/tou/accrue')) {
            return AuthState.MICROSOFT_UPDATE_TERM;
        }
        // Check for privacy notice
        const form = this.$('form#fmHF');
        if (form.length > 0 && form.attr('action')?.includes('privacynotice.account.microsoft.com')) {
            console.log(this.responce);
            this.lastResponse = this.responce
            // this.lastResponse = this.responce
            return AuthState.PRIVACY_NOTICE;
        }

        // Check for success states
        if (this.serverData?.sSigninName) {
            return AuthState.KMSI_PAGE_OK;
        }
        if (this.serverData?.sFTTag) {
            return AuthState.INITIAL_PAGE_OK;
        }
        if (this.$('title').text().includes('Microsoft account | Home')) {
            return AuthState.MICROSOFT_HOME_PAGE;
        }

        return AuthState.UNKNOWN_STATE;
    }

    extractPrivacyNoticeData() {
        const form = this.$('form#fmHF');
        if (form.length === 0) return null;

        const action = form.attr('action');
        const payload = {};

        form.find('input[type="hidden"]').each((i, el) => {
            const name = this.$(el).attr('name');
            const value = this.$(el).attr('value');
            if (name) payload[name] = value;
        });

        return { action, payload };
    }
}

// ============================================================================
// REDIRECT HANDLER
// ============================================================================

// class RedirectHandler {
//     static async analyzeRedirect(response, lastUrl ,config = {} ) {
//         const { status, headers, data } = response;
//         const $ = cheerio.load(data || '');
//         const serverData = HtmlParser.extractServerData(data);

//         // Handle 302 redirects
//         if (status === 302 && headers.location) {
//             return {
//                 type: 'HTTP_REDIRECT',
//                 url: this._resolveUrl(headers.location, lastUrl)
//             };
//         }

//         // Handle "Object moved" pages
//         if ($('title').text() === 'Object moved' && $('h2 > a[href]').length > 0) {
//             const href = $('h2 > a').attr('href');
//             return {
//                 type: 'MANUAL_REDIRECT',
//                 url: this._resolveUrl(href, lastUrl)
//             };
//         }

//         // Handle auto-submit forms
//         const autoForm = $('form#fmHF[name="fmHF"]');
//         if (autoForm.length > 0 && $('body[onload*="DoSubmit"]').length > 0) {
//             var urll =autoForm.attr('action')
//             if (urll.includes('tou/accrue')) {
//                 this.NextUpdateTerm = true
//             }


//             return {
//                 type: 'AUTO_SUBMIT',
//                 url: urll,
//                 payload: this._extractFormData($, autoForm)
//             };
//         }

//         // Handle proof freshness form
//         const proofForm = $('form#fProofFreshness');
//         if (proofForm.length > 0 && $('title').text().includes('security info')) {
//             const payload = this._extractFormData($, proofForm);
//             payload.ProofFreshnessAction = 1;
//             return {
//                 type: 'AUTO_SUBMIT',
//                 url: proofForm.attr('action'),
//                 payload
//             };
//         }

//         // Handle MSAL redirect
//         if (data.includes("msalInstance")) {
//             const metaTag = $('meta[http-equiv="refresh"]');
//             if (metaTag.length > 0) {
//                 const content = metaTag.attr('content');
//                 const urlMatch = content?.match(/url=(.*)/i);
//                 if (urlMatch) {
//                     return {
//                         type: 'MSAL_REDIRECT',
//                         url: urlMatch[1]
//                     };
//                 }
//             }
//         }

//         // Handle add proof form with skip
//         const frmAddProof = $('form#frmAddProof');

//         if (status === 200 && frmAddProof && frmAddProof.length > 0 && $('title').text().includes('protect your account')) {
//             try {
//                 // Extract form data with error handling
//                 const payload = this._extractFormData($, frmAddProof);

//                 if (!payload) {
//                     throw new Error('Failed to extract form data');
//                 }

//                 // Set default values
//                 payload.iProofOptions = "Email";
//                 payload.DisplayPhoneCountryISO = "US";
//                 payload.DisplayPhoneNumber = "";

//                 console.log('Initial payload:', payload);

//                 console.log(config.recoveryAccount);
//                  // Handle recovery email logic
//                 if (config.recoveryAccount.Add === true) {
//                     // Validate recovery email exists
//                     if (!config.recoveryAccount || !config.recoveryAccount.email) {
//                         throw new Error('Recovery email not configured');
//                     }
//                     payload.action = "AddProof";
//                     payload.EmailAddress = config.recoveryAccount.email;
//                 } else {
//                     payload.EmailAddress = "";
//                     payload.action = "Skip";
//                 }

//                 console.log('Final payload:', payload);

//                 // Validate form action URL
//                 const formAction = frmAddProof.attr('action');
//                 if (!formAction) {
//                     throw new Error('Form action URL not found');
//                 }

//                 return {
//                     type: 'AUTO_SUBMIT',
//                     url: formAction,
//                     payload
//                 };

//             } catch (error) {
//                 console.error('Error processing form:', error.message);
//                 throw error; // Re-throw or handle as needed
//             }
//         }        // if (status === 200 && frmAddProof.length > 0 && $('title').text().includes('protect your account')) {
//         //     const payload = this._extractFormData($, frmAddProof);
//         //     payload.iProofOptions = "Email";
//         //     payload.DisplayPhoneCountryISO = "US";
//         //     payload.DisplayPhoneNumber = "";


//         //     console.log(payload);
//         //     if (this.AddRecoveryEmail === true) {
//         //         payload.action = "AddProof";
//         //         payload.EmailAddress = this.config.recoveryAccount.email;
//         //     }else{
//         //         payload.EmailAddress = "";
//         //         payload.action = "Skip";
//         //     }

//         //     console.log(payload);
//         //     return {
//         //         type: 'AUTO_SUBMIT',
//         //         url: frmAddProof.attr('action'),
//         //         payload
//         //     };
//         // }

//         // Handle Verify proof form
//         const frmVerifyProof = $('form#frmVerifyProof');
//         if (status === 200 && frmVerifyProof.length > 0 && $('title').text().includes('Enter the code we sent to')) {

//             const otp = await question(`${$('title').text()} `);
//             console.log({otp});
//             const payload = this._extractFormData($, frmVerifyProof);
//             payload.iProofOptions = `OTT||${this.config.recoveryAccount.email}||Email||0||o`
//             payload.iOttText = otp
//             payload.GeneralVerify = 0

//             return {
//                 type: 'AUTO_SUBMIT',
//                 url: frmVerifyProof.attr('action'),
//                 payload
//             };
//         }

//         if (this.status === 200 && this.NextUpdateTerm === true && serverData?.sCanary !== undefined) {
//             let encoded = serverData?.sCanary
//             let decoded = JSON.parse(`"${encoded}"`);
//             var urll = serverData?.urlRU
//             var payload = {}
//             payload.canary = decoded

//             return {
//                 type: 'AUTO_SUBMIT',
//                 url: urll,
//                 payload
//             };
//         }

//         if (status=== 200 && $('title').text().includes('Sign in to your Microsoft account') && serverData?.sSignInUsername) {
//             // we need to enter password
//             var PPFT = HtmlParser.extractFlowToken(serverData)
//             var payload = {PPFT}

//             return { type: 'ENTER_PASSWORD' , url:serverData.urlPost ,  payload  };


//         }
//         // Final page
//         if (status === 200) {
//             return { type: 'FINAL_PAGE' };
//         }

//         return { type: 'UNKNOWN' };
//     }

//     static _extractFormData($, form) {
//         const data = {};
//         form.find('input[type="hidden"]').each((i, el) => {
//             const name = $(el).attr('name');
//             const value = $(el).attr('value');
//             if (name) data[name] = value;
//         });
//         return data;
//     }

//     static _resolveUrl(url, baseUrl) {
//         if (!url) return null;
//         if (url.startsWith('http')) return url;
//         if (url.startsWith('/') && baseUrl) {
//             try {
//                 return new URL(url, baseUrl).href;
//             } catch {
//                 return null;
//             }
//         }
//         return url;
//     }
// }


// Make sure you have the question function defined somewhere:
// Example implementation:
/*
const readline = require('readline');

function question(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}
*/
// ============================================================================
// MAIN AUTHENTICATION CLASS
// ============================================================================

class MicrosoftAuth {
    constructor(credentials, options = {}) {
        this.email = credentials.email;
        this.password = credentials.password;
        this.options = options;
        this.logPrefix = `[${this.email}]`;

        // Initialize session
        const jar = options.cookieJar ? HttpSession.importCookieJar(options.cookieJar) : null;
        this.session = new HttpSession(options.proxy, jar);
        this.sessionFresh = new HttpSession();

        // State tracking
        this.lastUrl = null;
        this.customData = null;
        this.apiTokens = null;
        this.mailboxValue = null;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    async login(cookieTypes = ['ALL']) {
        try {
            this.log('Starting authentication...');

            // Step 1: Initial authentication flow
            const authResult = await this._performAuthFlow();
            if (!authResult.success) {
                return authResult;
            }

            // Step 2: Get requested cookies
            const cookies = await this._getCookies(cookieTypes);

            return {
                success: true,
                message: "Authentication successful",
                cookies,
                cookieJar: this.session.exportCookieJar()
            };

        } catch (error) {
            return this._formatError(error);
        }
    }

    async Alt() {
        try {
            this.log('Starting Alternative Adding Process...');
            const authResult = await this._performAuthFlow();
            if (!authResult.success) {
                return authResult;
            }

            const response = await this.session.client.get(BASE_URLS.ALT);



            await this._followRedirects(response)

            console.log(this.lastResponse);
            fs.writeFile("./r2.html", this.lastResponse.data, (err, res) => {

            })
            return await this.getAccountInfo()



        } catch (error) {

        }
    }



    async verifySession() {
        try {
            const response = await this.session.client.get(
                `${BASE_URLS.ACCOUNT}home/api/profile/personal-info`,
                {
                    headers: {
                        'Accept': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                }
            );

            await this._authenticateOutlook()
            return {
                success: response.data.signInName === this.email,
                data: response.data
            };
        } catch {
            return { success: false };
        }
    }

    // ========================================================================
    // AUTHENTICATION FLOW
    // ========================================================================

    async _performAuthFlow() {
        // Get initial tokens
        const state = await this._getInitialPage();

        // Already logged in
        if (state === AuthState.MICROSOFT_HOME_PAGE) {
            this.log('Already authenticated');
            return { success: true };
        }

        // Post credentials

        await this._postUsername();
        const passwordState = await this._postPassword();

        if (passwordState === AuthState.MICROSOFT_HOME_PAGE) {
            this.log('Already authenticated');
            return { success: true };
        }
        // Handle various states
        return await this._handleAuthState(passwordState);
    }

    async _handleAuthState(state) {
        switch (state) {
            case AuthState.KMSI_PAGE_OK:
                return await this._handleKmsiPage();

            case AuthState.PRIVACY_NOTICE:
                const newState = await this._handlePrivacyNotice();
                return await this._handleAuthState(newState);

            case AuthState.ACCOUNT_LOCKED:
            case AuthState.REAUTH_NEEDED:
            case AuthState.PASSKEY_INTERRUPT:
            case AuthState.NEED_TO_ADD_ALT:
                return {
                    success: false,
                    state,
                    message: `Authentication blocked: ${state}`,
                    customData: this.customData
                };
            case AuthState.INITIAL_PAGE_OK:
                return await this._performAuthFlow()
            default:
                throw new AuthError(`Unexpected state: ${state}`, 'AUTH_FLOW');
        }
    }

    async _handleKmsiPage() {
        this.log('Handling "Keep me signed in" page...');
        const response = await this._postKmsi();
        await this._followRedirects(response);

        const verified = await this.verifySession();
        if (!verified.success) {
            throw new AuthError('Session verification failed', 'KMSI_VERIFICATION');
        }

        return { success: true };
    }

    // ========================================================================
    // AUTHENTICATION STEPS
    // ========================================================================

    async _getInitialPage() {
        try {

            this.log('Fetching initial page...');

            const response = await this.session.client.get(this.session.loginUrl);


            const analyzer = new ResponseAnalyzer(response);
            const state = analyzer.getAuthState();


            // console.log(response);

            console.log({ state });
            if (state === AuthState.MICROSOFT_HOME_PAGE) {
                return state;
            }
            if (state === AuthState.MICROSOFT_UPDATE_TERM) {
                await this._followRedirects(response)
                return await this._getInitialPage()
            }

            if (state === AuthState.PRIVACY_NOTICE) {
                this.lastResponse = response
                const newState = await this._handlePrivacyNotice();
                return await this._getInitialPage()

            }

            if (!state.includes("INITIAL_PAGE_OK")) {
                throw new AuthError(`Unexpected initial state: ${state}`, 'INITIAL_PAGE');
            }



            const serverData = HtmlParser.extractServerData(response.data);
            this.session.flowToken = HtmlParser.extractFlowToken(serverData);
            this.session.loginUrl = serverData.urlPost;

            return state;
        } catch (error) {
            console.log({ error });
        }
    }

    async _postUsername() {
        this.log('Submitting username...');

        const response = await this.session.client.post(
            'https://login.live.com/GetCredentialType.srf',
            {
                username: this.email,
                flowToken: this.session.flowToken
            }
        );

        this.customData = response.data;

        if (response.data.IfExistsResult !== 0) {
            throw new AuthError('Account does not exist', 'POST_USERNAME');
        }
    }

    async _postPassword() {
        this.log('Submitting password...');
        const postData = new URLSearchParams({
            login: this.email,
            loginfmt: this.email,
            passwd: this.password,
            PPFT: this.session.flowToken,
            type: '11',
            ps: '2',
            NewUser: '1',
            i19: '16425'
        }).toString();

        const response = await this.session.client.post(
            this.session.loginUrl,
            postData,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const analyzer = new ResponseAnalyzer(response);
        const state = analyzer.getAuthState();

        if (state === AuthState.KMSI_PAGE_OK) {
            const serverData = HtmlParser.extractServerData(response.data);
            this.session.flowToken = serverData.sFT;
            this.session.loginUrl = serverData.urlPost;
        }

        this.log('Done password...');
        console.log(state);
        if (state === AuthState.MICROSOFT_UPDATE_TERM) {
            await this._followRedirects(response)
            return await this._getInitialPage()
        }

        if (state === AuthState.PRIVACY_NOTICE) {
            this.lastResponse = response
            await this._handlePrivacyNotice()
            return await this._getInitialPage()
        }
        const state2 = analyzer.getAuthState();
        console.log(state2);
        return state2;

    }

    async _postKmsi() {
        this.log('Confirming "Stay signed in"...');

        if (!this.session.flowToken) {
            throw new AuthError('Missing flow token', 'KMSI');
        }

        const postData = new URLSearchParams({
            LoginOptions: '1',
            type: '28',
            ctx: '',
            hpgrequestid: '',
            PPFT: this.session.flowToken,
            canary: ''
        }).toString();

        const response = await this.session.client.post(
            this.session.loginUrl,
            postData,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        if (response.status !== 302 || !response.headers.location) {
            throw new AuthError('Expected redirect after KMSI', 'KMSI');
        }

        return response;
    }

    async _handlePrivacyNotice() {
        this.log('Handling privacy notice...');
        console.log(this.lastResponse);

        fs.writeFile("./privacy.html", this.lastResponse.data, (err, res) => {

        })
        const analyzer = new ResponseAnalyzer(this.lastResponse || '');
        const noticeData = analyzer.extractPrivacyNoticeData();

        if (!noticeData) {
            throw new AuthError('Could not extract privacy notice data', 'PRIVACY_NOTICE');
        }

        // Submit initial notice
        const postData = new URLSearchParams(noticeData.payload).toString();
        const response1 = await this.session.client.post(
            noticeData.action,
            postData,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        // Extract UCIS data
        const ucisData = HtmlParser.extractUcisData(response1.data);
        if (!ucisData) {
            throw new AuthError('Could not extract UCIS data', 'PRIVACY_NOTICE');
        }

        // Submit consent
        const formData = new FormData();
        formData.append('ClientId', ucisData.ClientId);
        formData.append('ConsentSurface', 'SISU');
        formData.append('ConsentType', 'ucsisunotice');
        formData.append('correlation_id', ucisData.CorrelationId);
        formData.append('CountryRegion', 'US');
        formData.append('DeviceId', '');
        formData.append('SerializedEncryptionData', ucisData.SerializedEncryptionData);
        formData.append('FormFactor', 'Desktop');
        formData.append('Market', 'EN-GB');
        formData.append('ModelType', 'ucsisunotice');
        formData.append('ModelVersion', ucisData.ModelVersion);
        formData.append('NoticeId', ucisData.NoticeId);
        formData.append('Platform', 'Web');
        formData.append('UserId', ucisData.UserId);
        formData.append('UserVersion', '1');

        await this.session.client.post(
            'https://privacynotice.account.microsoft.com/recordnotice',
            formData,
            { headers: formData.getHeaders() }
        );

        // Get next URL
        const actionUrl = new URL(noticeData.action);
        const nextUrl = actionUrl.searchParams.get('ru');
        const finalResponse = await this.session.client.get(nextUrl);

        const finalAnalyzer = new ResponseAnalyzer(finalResponse);
        const state = finalAnalyzer.getAuthState();

        if (state === AuthState.KMSI_PAGE_OK) {
            const serverData = HtmlParser.extractServerData(finalResponse.data);
            this.session.flowToken = serverData.sFT;
            this.session.loginUrl = serverData.urlPost;
        }

        return state;
    }

    // ========================================================================
    // REDIRECT HANDLING
    // ========================================================================


    // In your MicrosoftAuth class
    async _followRedirects(initialResponse, maxRedirects = 20) {
        const handler = new EnhancedRedirectHandler(this.options);

        // Use handler.analyzeRedirect() instead of RedirectHandler.analyzeRedirect()
        let currentResponse = initialResponse;

        for (let i = 0; i < maxRedirects; i++) {
            const analysis = await handler.analyzeRedirect(currentResponse, this.lastUrl);


            // Rest of your existing redirect handling logic
            switch (analysis.type) {
                case 'HTTP_REDIRECT':
                case 'MANUAL_REDIRECT':
                case 'MSAL_REDIRECT':
                    this.lastUrl = analysis.url;
                    currentResponse = await this.session.client.get(analysis.url);
                    break;

                case 'AUTO_SUBMIT':
                    this.lastUrl = analysis.url;
                    const postData = new URLSearchParams(analysis.payload).toString();
                    currentResponse = await this.session.client.post(
                        analysis.url,
                        postData,
                        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                    );
                    if (analysis.log) {
                        console.log(currentResponse);
                    }
                    break;

                case 'ENTER_PASSWORD':
                    const postData2 = new URLSearchParams({
                        login: this.email,
                        loginfmt: this.email,
                        passwd: this.password,
                        PPFT: analysis.payload.PPFT,
                        type: '11',
                        ps: '2',
                        NewUser: '1',
                        i13: '16425'
                    }).toString();

                    currentResponse = await this.session.client.post(
                        analysis.url,
                        postData2,
                        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                    );
                    break;

                case 'FINAL_PAGE':
                    this.lastResponse = currentResponse;
                    return;

                default:
                    throw new AuthError(`Unknown redirect type: ${analysis.type}`, 'REDIRECTS');
            }

        }

        throw new AuthError('Exceeded maximum redirects', 'REDIRECTS');
    }
    // async _followRedirects(initialResponse, maxRedirects = 20) {
    //     this.log('Following redirects...');
    //     let currentResponse = initialResponse;

    //     for (let i = 0; i < maxRedirects; i++) {
    //         const analysis = await  RedirectHandler.analyzeRedirect(currentResponse, this.lastUrl , this.options);
    //         console.log(analysis);
    //         switch (analysis.type) {
    //             case 'HTTP_REDIRECT':
    //             case 'MANUAL_REDIRECT':
    //             case 'MSAL_REDIRECT':
    //                 this.log(`  -> Redirect to: ${analysis.url}`);
    //                 this.lastUrl = analysis.url;
    //                 currentResponse = await this.session.client.get(analysis.url);
    //                 break;

    //             case 'AUTO_SUBMIT':
    //                 this.log(`  -> Auto-submit to: ${analysis.url}`);


    //                 this.lastUrl = analysis.url;
    //                 const postData = new URLSearchParams(analysis.payload).toString();
    //                 currentResponse = await this.session.client.post(
    //                     analysis.url,
    //                     postData,
    //                     { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    //                 );
    //                 // console.log(currentResponse);
    //                 break;

    //             case 'FINAL_PAGE':
    //                 this.log('Reached final page');
    //                 this.lastResponse = currentResponse;

    //                 // Extract mailbox if needed
    //                 const mailbox = HtmlParser.extractMailboxCookie(currentResponse.headers);
    //                 if (mailbox) {
    //                     this.mailboxValue = mailbox;
    //                     this.log(`  -> Found mailbox: ${mailbox}`);
    //                 }
    //                 return;
    //             case 'ENTER_PASSWORD':
    //                 this.log('Need to Enter Password');
    //                 const postData2 = new URLSearchParams({
    //                     login: this.email,
    //                     loginfmt: this.email,
    //                     passwd: this.password,
    //                     PPFT: analysis.payload.PPFT,
    //                     type: '11',
    //                     ps: '2',
    //                     NewUser: '1',
    //                     i13: '16425'
    //                 }).toString();

    //                 currentResponse = await this.session.client.post(
    //                     analysis.url,
    //                     postData2,
    //                     { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    //                 );
    //                 break;

    //             default:
    //                 console.log(currentResponse);

    //                 fs.writeFile("./unknown.html",currentResponse.data,(err,rws)=>{

    //                 })
    //                 throw new AuthError(`Unknown redirect type: ${analysis.type}`, 'REDIRECTS');
    //         }
    //     }

    //     throw new AuthError('Exceeded maximum redirects', 'REDIRECTS');
    // }
    // ========================================================================
    // COOKIE RETRIEVAL
    // ========================================================================
    async _getCookies(types) {
        const cookies = {};

        for (const type of types) {
            switch (type.toUpperCase()) {
                case 'ALL':
                    const verified = await this.verifySession();
                    cookies.all = verified.success;
                    break;

                case 'REWARDS':
                    cookies.rewards = await this._authenticateRewards();
                    break;

                case 'OUTLOOK':
                    cookies.outlook = await this._authenticateOutlook();
                    break;

                case 'BING':
                    cookies.bing = await this._authenticateBing();
                    break;
            }

        }

        return cookies;
    }
    async _authenticateRewards() {
        this.log('Authenticating for Rewards...');
        const response = await this.session.client.get(BASE_URLS.REWARDS);
        await this._followRedirects(response);

        const verifyResponse = await this.session.client.get('https://rewards.bing.com/');
        return verifyResponse.status === 200;
    }
    async _authenticateBing() {
        this.log('Authenticating for Bing...');
        const response = await this.session.client.get(BASE_URLS.BING + `fd/auth/signin/v2?action=interactive&isSilent=true`);
        await this._followRedirects(response);
        console.log(await this.session.getCookiesForDomain("https://www.bing.com"));

        return true
    }

    async _getInitialPage2() {
        try {

            this.log('Fetching initial page...');

            const response = await this.sessionFresh.client.get(this.session.loginUrl);


            const analyzer = new ResponseAnalyzer(response);
            const state = analyzer.getAuthState();


            // console.log(response);

            console.log({ state });
            if (state === AuthState.MICROSOFT_HOME_PAGE) {
                return state;
            }
            if (state === AuthState.MICROSOFT_UPDATE_TERM) {
                await this._followRedirects(response)
                return await this._getInitialPage()
            }

            if (state === AuthState.PRIVACY_NOTICE) {
                this.lastResponse = response
                const newState = await this._handlePrivacyNotice();
                return await this._getInitialPage()

            }

            if (!state.includes("INITIAL_PAGE_OK")) {
                throw new AuthError(`Unexpected initial state: ${state}`, 'INITIAL_PAGE');
            }



            const serverData = HtmlParser.extractServerData(response.data);
            this.session.flowToken = HtmlParser.extractFlowToken(serverData);
            this.session.loginUrl = serverData.urlPost;

            return state;
        } catch (error) {
            console.log({ error });
        }
    }
    async GetAccountInformation() {
        this.customData = null
        await this._getInitialPage2();
        await this._postUsername();

        return {
            success: true,
            data: this.customData
        }
    }
    async _DoForceAlt() {
        const response = await this.session.client.get(BASE_URLS.ALT);
        await this._followRedirects(response)
        console.log("FORCE ALT DONE ");
        return { success: true }
    }
    async _getBingTokens() {
        const msalConfig = {
            clientId: "077c9b95-2f57-4442-8872-134fcc08fcb3",
            authority: "https://login.microsoftonline.com/consumers",
            redirectUri: "https://www.bing.com/identity/idtokenv2",
            scopes: [
                "email",
                "openid",
                "profile",
                "offline_access"
            ],
            Origin: "https://www.bing.com/",
            prompt: "none",
            "x-client-VER": "8.12.1.0",
            "x-client-SKU": "ID_NET9_0",
            response_mode: "form_post"
        };

        try {
            const { redirectUrl, requestContext } = createMicrosoftAuthUrl.createMicrosoftAuthUrl(msalConfig);

            // Follow auth redirects
            let currentUrl = redirectUrl;
            let finalResponse;

            for (let i = 0; i < 2; i++) {
                const response = await this.session.client.get(currentUrl, {
                    headers: {
                        'Referer': 'https://www.bing.com/',
                        'Sec-Fetch-Dest': 'iframe',
                        'Sec-Fetch-Site': 'cross-site'
                    }
                });

                if (response.headers.location &&
                    !response.headers.location.includes('#code') &&
                    !response.headers.location.includes('interaction_required')) {
                    currentUrl = new URL(response.headers.location, currentUrl).href;
                } else {
                    finalResponse = response;
                    break;
                }
            }


            console.log(finalResponse);



            this.log('  -> Successfully acquired and saved API tokens');
            return true;

        } catch (error) {
            this.log(`Failed to get Bing tokens: ${error.message}`);
            return false;
        }
    }
    _decodeJwtPayload(token) {
        try {
            // A JWT is composed of three parts separated by dots: header, payload, and signature.
            // We split the token and take the second part, which is the payload.
            const payloadBase64Url = token.split('.')[1];

            // The payload is Base64Url encoded. We need to replace URL-safe characters
            // back to standard Base64 characters.
            const payloadBase64 = payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/');

            // Decode the Base64 string into a JSON string using Buffer.
            const payloadJson = Buffer.from(payloadBase64, 'base64').toString();

            // Parse the JSON string into a JavaScript object.
            return JSON.parse(payloadJson);
        } catch (error) {
            console.error("Failed to decode JWT:", error);
            return null;
        }
    }
    async _authenticateOutlook() {
        this.log('Authenticating for Outlook...');



        // Check if we already have valid tokens
        const savedTokens = this.session.getMetadata('outlookTokens');
        const savedMailbox = this.session.getMetadata('mailboxValue');

        if (savedTokens && savedMailbox) {
            this.log('  -> Found saved Outlook tokens, verifying...');

            // Verify tokens are still valid
            if (await this._verifyOutlookTokens(savedTokens)) {
                this.log('  -> Saved tokens are valid!');
                this.apiTokens = savedTokens;
                this.mailboxValue = savedMailbox;
                return true;
            } else {
                this.log('  -> Saved tokens expired, refreshing...');

                // Try to refresh using refresh_token
                const refreshed = await this._refreshOutlookTokens(savedTokens.refresh_token);
                if (refreshed) {
                    return true;
                }
            }
        }

        // No valid saved tokens, perform full authentication
        this.log('  -> Performing full Outlook authentication...');
        const response = await this.session.client.get(BASE_URLS.OUTLOOK);


        await this._followRedirects(response);

        const success = await this._getOutlookTokens();

        // Save tokens to metadata if successful
        if (success && this.apiTokens) {
            this.session.setMetadata('outlookTokens', this.apiTokens);

            var tokens = this._decodeJwtPayload(this.apiTokens.id_token)
            this.mailboxValue = tokens.puid + "@" + BASE_URLS.TENANT_ID_VALUE
            this.session.setMetadata('mailboxValue', this.mailboxValue);
            this.session.setMetadata('outlookTokensExpiry', Date.now() + (this.apiTokens.expires_in * 1000));
            this.log('  -> Saved Outlook tokens to session');
        }

        return success;
    }
    async _verifyOutlookTokens(tokens) {
        try {
            // Try to use the access token to make a simple API call
            const response = await this.session.client.get(
                'https://outlook.office.com/api/v2.0/me',
                {
                    headers: {
                        'Authorization': `Bearer ${tokens.access_token}`,
                        'Accept': 'application/json'
                    },
                    validateStatus: (status) => status < 500 // Allow 401/403 to be caught
                }
            );

            return response.status === 200;
        } catch (error) {
            // Token is invalid or expired
            return false;
        }
    }
    async _refreshOutlookTokens(refreshToken) {
        try {
            this.log('  -> Refreshing Outlook tokens...');

            const msalConfig = {
                clientId: "9199bf20-a13f-4107-85dc-02114787ef48",
                scopes: [
                    "service::outlook.office.com::MBI_SSL",
                    "openid",
                    "profile",
                    "offline_access"
                ].join(' '),
                Origin: "https://outlook.live.com/"
            };

            const tokenData = new URLSearchParams({
                client_id: msalConfig.clientId,
                scope: msalConfig.scopes,
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            }).toString();

            const response = await this.session.client.post(
                'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
                tokenData,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Origin': msalConfig.Origin
                    }
                }
            );

            if (response.data && response.data.access_token) {
                this.apiTokens = response.data;

                // Save refreshed tokens
                this.session.setMetadata('outlookTokens', this.apiTokens);
                this.session.setMetadata('outlookTokensExpiry', Date.now() + (this.apiTokens.expires_in * 1000));

                this.log('  -> Successfully refreshed tokens');
                return true;
            }

            return false;
        } catch (error) {
            this.log(`  -> Token refresh failed: ${error.message}`);
            return false;
        }
    }
    async _getOutlookTokens(retry = false) {
        const msalConfig = {
            clientId: "9199bf20-a13f-4107-85dc-02114787ef48",
            authority: "https://login.microsoftonline.com/consumers",
            redirectUri: "https://outlook.live.com/mail/oauthRedirect.html",
            scopes: [
                "service::outlook.office.com::MBI_SSL",
                "openid",
                "profile",
                "offline_access"
            ],
            Origin: "https://outlook.live.com/",
            prompt: "none"
        };

        try {
            const { redirectUrl, requestContext } = createMicrosoftAuthUrl.createMicrosoftAuthUrl(msalConfig);

            // Follow auth redirects
            let currentUrl = redirectUrl;
            let finalResponse;

            for (let i = 0; i < 2; i++) {
                const response = await this.session.client.get(currentUrl, {
                    headers: {
                        'Referer': 'https://outlook.live.com/',
                        'Sec-Fetch-Dest': 'iframe',
                        'Sec-Fetch-Site': 'cross-site'
                    }
                });

                if (response.headers.location &&
                    !response.headers.location.includes('#code') &&
                    !response.headers.location.includes('interaction_required')) {
                    currentUrl = new URL(response.headers.location, currentUrl).href;
                } else {
                    finalResponse = response;
                    break;
                }
            }

            if (!finalResponse) {
                throw new AuthError('No final response in OAuth flow', 'OUTLOOK_TOKENS');
            }

            // Extract authorization code
            const finalUrl = new URL(finalResponse.headers.location.replace('#', '?'));
            const code = finalUrl.searchParams.get('code');

            if (!code) {
                if (!retry && finalUrl.searchParams.get('error')) {
                    // Retry once
                    const response = await this.session.client.get(
                        'https://login.live.com/login.srf?wreply=https://outlook.live.com/owa/0/'
                    );
                    await this._followRedirects(response);
                    return await this._getOutlookTokens(true);
                }
                throw new AuthError('Could not extract authorization code', 'OUTLOOK_TOKENS');
            }

            // Exchange code for tokens
            const tokenData1 = new URLSearchParams({
                client_id: msalConfig.clientId,
                scope: requestContext.scopes,
                redirect_uri: msalConfig.redirectUri,
                grant_type: 'authorization_code',
                code: code,
                code_verifier: requestContext.codeVerifier,
                client_info: '1',
                'client-request-id': requestContext.correlationId,
                'x-client-SKU': 'msal.js.browser',
                'x-client-VER': "4.14.0",
                'x-ms-lib-capability': "retry-after, h429",
                'x-client-current-telemetry': "5|863,0,,,|,",
                'x-client-last-telemetry': "5|0|||0,0",
                claims: '{"access_token":{"xms_cc":{"values":["CP1"]}}}'
            }).toString();

            const tokenResponse1 = await this.session.client.post(
                'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
                tokenData1,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Origin': msalConfig.Origin
                    }
                }
            );
            this.apiTokens = tokenResponse1.data;
            var outlook_tokens = tokenResponse1.data


            var tokens = this._decodeJwtPayload(outlook_tokens.id_token)
            this.mailboxValue = tokens.puid + "@" + BASE_URLS.TENANT_ID_VALUE
            // // Refresh tokens for final scope
            // const tokenData2 = new URLSearchParams({
            //     client_id: msalConfig.clientId,
            //     scope: requestContext.scopes,
            //     grant_type: 'refresh_token',
            //     refresh_token: tokenResponse1.data.refresh_token
            // }).toString();

            // const tokenResponse2 = await this.session.client.post(
            //     'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
            //     tokenData2,
            //     {
            //         headers: {
            //             'Content-Type': 'application/x-www-form-urlencoded',
            //             'Origin': msalConfig.Origin
            //         }
            //     }
            // );

            console.log(outlook_tokens.access_token);
            const verifyOutlook = new URLSearchParams({
                localeName: 'en-GB',
                tzid: 'America/Chicago',
                saveLanguageAndTimezone: 1,

            }).toString();
            try {

                const verifyOutlookRes = await this.session.client.post(
                    'https://outlook.live.com/owa/0/lang.owa?app=Mail',
                    verifyOutlook,
                    {
                        headers: {
                            'Host': 'outlook.live.com',
                            'Sec-Ch-Ua-Platform': '"macOS"',
                            'Authorization': `MSAuth1.0 usertoken="${outlook_tokens.access_token}", type="MSACT"`,
                            'X-Anchormailbox': `PUID:${this.mailboxValue}`,
                            'Sec-Ch-Ua': '"Chromium";v="141", "Not?A_Brand";v="8"',
                            'Sec-Ch-Ua-Mobile': '?0',
                            'Accept-Language': 'en-GB,en;q=0.9',
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Accept': '*/*',
                            'Origin': 'https://outlook.live.com',
                            'Sec-Fetch-Site': 'same-origin',
                            'Sec-Fetch-Mode': 'cors',
                            'Sec-Fetch-Dest': 'empty',
                            'Referer': 'https://outlook.live.com/',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Priority': 'u=4, i',
                        }
                    }
                );
                console.log({ verifyOutlookRes });
            } catch (error) {
                console.log(error);
            }

            this.apiTokens = tokenResponse1.data;

            // Save tokens and mailbox to session metadata
            this.session.setMetadata('outlookTokens', this.apiTokens);
            this.session.setMetadata('mailboxValue', this.mailboxValue);
            this.session.setMetadata('outlookTokensExpiry', Date.now() + (this.apiTokens.expires_in * 1000));

            this.log('  -> Successfully acquired and saved API tokens');
            return true;

        } catch (error) {
            console.log(error);
            this.log(`Failed to get Outlook tokens: ${error.message}`);
            return false;
        }
    }
    // ========================================================================
    // Alternative Email
    // ========================================================================
    async _getAlternativeAccount() {
        if (this.options?.recoveryAccount?.email) {
            return { success: false, state: "recoveryAccount_NOT_FOUND" }
        }
        var account = await Accounts.findOne({ email: this.options?.recoveryAccount?.email })
        if (!account) {
            return { success: false, state: "recoveryAccount_account_NOT_FOUND" }
        }



    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    log(message) {
        console.log(`${this.logPrefix} ${message}`);
    }

    _formatError(error) {
        if (error instanceof AuthError) {
            return {
                success: false,
                error: error.message,
                step: error.step,
                details: error.details
            };
        }

        return {
            success: false,
            error: error.message || 'Unknown error',
            step: 'UNKNOWN'
        };
    }


}

// ============================================================================
// EXPORT & USAGE EXAMPLES
// ============================================================================

module.exports = {
    MicrosoftAuth,
    AuthState,
    AuthError,
    HttpSession,
    HtmlParser
};

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

//login
//alt
//re auth
// lock





// /**
//  * Example 1: Basic login
//  */
// xbttb510330@hotmail.com;twgq1699
// async function basicLogin() {
//     const auth = new MicrosoftAuth(
//         { email: 'xbttb510330@hotmail.com', password: 'twgq1699' }
//     );

//     const result = await auth.login(['ALL', 'BING',"REWARDS","OUTLOOK"]);

//     if (result.success) {
//         console.log('Login successful!');
//         console.log('Cookies:', result.cookies);
//         console.log(auth.session.exportCookieJar());
//         fs.writeFile("./cki.json", auth.session.exportCookieJar(),(err,ress)=>{

//         })
//         // console.log('Cookie Jar:', result.cookieJar);
//     } else {
//         console.error('Login failed:', result.error);
//     }
// }



// basicLogin()
// /**
//  * Example 2: Login with saved session
//  */
// async function loginWithSavedSession(savedCookieJar) {
//     const auth = new MicrosoftAuth(
//         { email: 'user@hotmail.com', password: 'password123' },
//         { cookieJar: savedCookieJar }
//     );

//     const result = await auth.login(['REWARDS']);
//     return result;
// }

// /**
//  * Example 3: Login with proxy
//  */
// async function loginWithProxy() {
//     const auth = new MicrosoftAuth(
//         { email: 'user@hotmail.com', password: 'password123' },
//         {
//             proxy: {
//                 host: 'proxy.example.com',
//                 port: 8080,
//                 username: 'proxyuser',
//                 password: 'proxypass'
//             }
//         }
//     );

//     return await auth.login();
// }

// /**
//  * Example 4: Get account information without full login
//  */
// async function getAccountInfo() {
//     const auth = new MicrosoftAuth(
//         { email: 'user@hotmail.com', password: 'password123' }
//     );

//     const result = await auth.getAccountInfo();

//     if (result.success) {
//         console.log('Account data:', result.data);
//     }
// }

// /**
//  * Example 5: Verify existing session
//  */

// const SCJ = require("./cookie.json")
// async function verifyExistingSession(savedCookieJar) {
//     const auth = new MicrosoftAuth(
//         { email: 'user@hotmail.com', password: 'password123' },
//         { cookieJar: savedCookieJar }
//     );

//     const result = await auth.verifySession();

//     if (result.success) {
//         console.log('Session is valid!');
//         console.log('User data:', result.data);
//     } else {
//         console.log('Session expired, need to re-login');
//     }
// }


// const SCJc = require("./cookie.json")
async function AddAlternative(savedCookieJar) {
    // const cookieJarString = JSON.stringify(savedCookieJar);
    const auth = new MicrosoftAuth(
        { email: 'dzmcjnmv5259@hotmail.com', password: 'wjqyizuv9542220' },
        // { recoveryAccount:{Add:true,email:"oixobvys583567@hotmail.com",password:"qfyteepx6690270"} , isDoAlt:false}
    );
    console.log(auth);

    //  const result = await auth.getAccountInfo()
    // console.log(JSON.stringify(result));
    const result = await auth.login(['ALL', 'BING', "REWARDS", "OUTLOOK"]);
    if (result.success) {
        console.log('Login successful!');
        console.log('Cookies:', result.cookies);
        console.log(auth.session.exportCookieJar());
        fs.writeFile("./cki.json", auth.session.exportCookieJar(), (err, ress) => {

        })
        console.log('Cookie Jar:', result.cookieJar);
    } else {
        console.error('Login failed:', result.error);
    }



    // if (result.success) {
    //     console.log('Session is valid!');
    //     console.log('User data:', result.data);
    // } else {
    //     console.log('Session expired, need to re-login');
    // }
}

// AddAlternative("")
// /**
//  * Example 6: Batch processing with error handling
//  */
// async function batchLogin(accounts) {
//     const results = [];

//     for (const account of accounts) {
//         try {
//             const auth = new MicrosoftAuth(
//                 { email: account.email, password: account.password },
//                 { cookieJar: account.savedCookieJar }
//             );

//             const result = await auth.login(['ALL']);

//             results.push({
//                 email: account.email,
//                 success: result.success,
//                 cookies: result.cookies,
//                 cookieJar: result.cookieJar,
//                 error: result.error
//             });

//             // Save updated cookie jar back to database
//             if (result.success) {
//                 await saveCookieJarToDatabase(account.email, result.cookieJar);
//             }

//         } catch (error) {
//             results.push({
//                 email: account.email,
//                 success: false,
//                 error: error.message
//             });
//         }
//     }

//     return results;
// }

// /**
//  * Example 7: Handle specific error states
//  */
// async function loginWithErrorHandling() {
//     const auth = new MicrosoftAuth(
//         { email: 'user@hotmail.com', password: 'password123' }
//     );

//     const result = await auth.login();

//     if (!result.success) {
//         switch (result.state) {
//             case AuthState.INVALID_CREDENTIALS:
//                 console.log('Invalid username or password');
//                 // Update database to flag account for review
//                 break;

//             case AuthState.ACCOUNT_LOCKED:
//                 console.log('Account is locked');
//                 // Mark account as locked in database
//                 break;

//             case AuthState.REAUTH_NEEDED:
//                 console.log('Re-authentication required');
//                 // Trigger manual verification flow
//                 break;

//             case AuthState.PASSKEY_INTERRUPT:
//                 console.log('Passkey verification needed');
//                 // Handle passkey flow
//                 break;

//             case AuthState.NEED_TO_ADD_ALT:
//                 console.log('Need to add alternative email/phone');
//                 // Handle recovery account addition
//                 break;

//             default:
//                 console.log('Unknown error:', result.error);
//         }
//     }

//     return result;
// }

// /**
//  * Example 8: Get specific cookie types only
//  */
// async function getSpecificCookies() {
//     const auth = new MicrosoftAuth(
//         { email: 'user@hotmail.com', password: 'password123' }
//     );

//     // Only get Rewards cookies
//     const result = await auth.login(['REWARDS']);

//     return {
//         success: result.success,
//         rewardsCookies: result.cookies.rewards
//     };
// }

// /**
//  * Example 9: Complete workflow with database integration
//  */
// async function completeWorkflow(accountData) {
//     // Load account from database
//     const account = await loadAccountFromDatabase(accountData.email);

//     // Create auth instance with saved cookies
//     const auth = new MicrosoftAuth(
//         { email: account.email, password: account.password },
//         {
//             cookieJar: account.cookieJar,
//             proxy: account.proxy
//         }
//     );

//     // First, try to verify existing session
//     let sessionValid = await auth.verifySession();

//     if (!sessionValid.success) {
//         // Session expired, perform full login
//         console.log('Session expired, performing full login...');
//         const loginResult = await auth.login(['ALL', 'REWARDS', 'OUTLOOK']);

//         if (!loginResult.success) {
//             // Handle login failure
//             await updateAccountStatus(account.email, 'LOGIN_FAILED', loginResult);
//             return { success: false, error: loginResult.error };
//         }

//         // Save new cookies
//         await updateAccountCookies(account.email, loginResult.cookieJar);
//     }

//     // Perform tasks with authenticated session
//     const taskResults = await performAccountTasks(auth);

//     // Update last activity
//     await updateLastActivity(account.email);

//     return { success: true, results: taskResults };
// }

// /**
//  * Helper function to save cookies (example implementation)
//  */
// async function saveCookieJarToDatabase(email, cookieJar) {
//     // Implement your database save logic here
//     console.log(`Saving cookies for ${email}`);
//     // await db.accounts.updateOne(
//     //     { email },
//     //     { $set: { cookieJar, lastUpdated: new Date() } }
//     // );
// }

// /**
//  * Helper function to load account (example implementation)
//  */
// async function loadAccountFromDatabase(email) {
//     // Implement your database load logic here
//     console.log(`Loading account ${email}`);
//     // return await db.accounts.findOne({ email });
//     return {
//         email: 'user@hotmail.com',
//         password: 'password123',
//         cookieJar: null,
//         proxy: null
//     };
// }

// /**
//  * Helper function to update account status (example implementation)
//  */
// async function updateAccountStatus(email, status, details) {
//     console.log(`Updating status for ${email}: ${status}`);
//     // await db.accounts.updateOne(
//     //     { email },
//     //     { $set: { status, statusDetails: details, lastChecked: new Date() } }
//     // );
// }

// /**
//  * Helper function to update cookies (example implementation)
//  */
// async function updateAccountCookies(email, cookieJar) {
//     console.log(`Updating cookies for ${email}`);
//     // await db.accounts.updateOne(
//     //     { email },
//     //     { $set: { cookieJar, lastUpdated: new Date() } }
//     // );
// }

// /**
//  * Helper function to update last activity (example implementation)
//  */
// async function updateLastActivity(email) {
//     console.log(`Updating last activity for ${email}`);
//     // await db.accounts.updateOne(
//     //     { email },
//     //     { $set: { lastActivity: new Date() } }
//     // );
// }

// /**
//  * Example 10: Access saved tokens from cookie jar
//  */
// async function accessSavedTokens(savedCookieJar) {
//     const auth = new MicrosoftAuth(
//         { email: 'user@hotmail.com', password: 'password123' },
//         { cookieJar: savedCookieJar }
//     );

//     // Tokens are automatically loaded from metadata
//     // Just authenticate (it will use saved tokens if valid)
//     const result = await auth.login(['OUTLOOK']);

//     if (result.success) {
//         // Access the tokens directly
//         console.log('API Tokens:', auth.apiTokens);
//         console.log('Mailbox Value:', auth.mailboxValue);

//         // Or access from session metadata
//         const tokens = auth.session.getMetadata('outlookTokens');
//         const mailbox = auth.session.getMetadata('mailboxValue');
//         const expiry = auth.session.getMetadata('outlookTokensExpiry');

//         console.log('Tokens from metadata:', tokens);
//         console.log('Mailbox from metadata:', mailbox);
//         console.log('Token expiry:', new Date(expiry));

//         // Use tokens for API calls
//         await makeOutlookApiCall(tokens.access_token);
//     }
// }

// /**
//  * Example 11: Check if tokens need refresh before using
//  */
// async function smartTokenUsage(savedCookieJar) {
//     const auth = new MicrosoftAuth(
//         { email: 'user@hotmail.com', password: 'password123' },
//         { cookieJar: savedCookieJar }
//     );

//     // Check token expiry from metadata
//     const expiry = auth.session.getMetadata('outlookTokensExpiry');
//     const tokens = auth.session.getMetadata('outlookTokens');

//     if (expiry && Date.now() < expiry - 300000) { // 5 min buffer
//         console.log('Tokens still valid, using saved tokens');
//         auth.apiTokens = tokens;
//         auth.mailboxValue = auth.session.getMetadata('mailboxValue');
//     } else {
//         console.log('Tokens expired or about to expire, re-authenticating');
//         await auth.login(['OUTLOOK']);
//     }

//     // Now use the tokens
//     return {
//         accessToken: auth.apiTokens.access_token,
//         mailbox: auth.mailboxValue
//     };
// }

// /**
//  * Example 12: Manually set and retrieve metadata
//  */
// async function manualMetadataUsage() {
//     const auth = new MicrosoftAuth(
//         { email: 'user@hotmail.com', password: 'password123' }
//     );

//     // Set custom metadata
//     auth.session.setMetadata('customKey', { foo: 'bar' });
//     auth.session.setMetadata('lastTaskTime', Date.now());

//     // Get metadata
//     const customData = auth.session.getMetadata('customKey');
//     const lastTask = auth.session.getMetadata('lastTaskTime');

//     // Check if metadata exists
//     if (auth.session.hasMetadata('customKey')) {
//         console.log('Custom data exists:', customData);
//     }

//     // Get all metadata
//     const allMeta = auth.session.getAllMetadata();
//     console.log('All metadata:', allMeta);

//     // Export with metadata
//     const exportedJar = auth.session.exportCookieJar();

//     // Later, import and metadata is preserved
//     const restoredAuth = new MicrosoftAuth(
//         { email: 'user@hotmail.com', password: 'password123' },
//         { cookieJar: exportedJar }
//     );

//     const restoredCustom = restoredAuth.session.getMetadata('customKey');
//     console.log('Restored custom data:', restoredCustom);
// }

// /**
//  * Example 13: Make Outlook API calls with saved tokens
//  */
// async function makeOutlookApiCall(accessToken, mailbox) {
//     const axios = require('axios');

//     // Example: Get inbox messages
//     const response = await axios.get(
//         'https://outlook.office.com/api/v2.0/me/messages',
//         {
//             headers: {
//                 'Authorization': `Bearer ${accessToken}`,
//                 'X-AnchorMailbox': mailbox,
//                 'Accept': 'application/json'
//             },
//             params: {
//                 '$top': 10,
//                 '$select': 'Subject,From,ReceivedDateTime'
//             }
//         }
//     );

//     return response.data;
// }

// /**
//  * Example 14: Complete workflow with token persistence
//  */
// async function completeWorkflowWithTokens(accountData) {
//     // Load account from database
//     const account = await loadAccountFromDatabase(accountData.email);

//     // Create auth instance with saved cookies (which includes tokens)
//     const auth = new MicrosoftAuth(
//         { email: account.email, password: account.password },
//         { cookieJar: account.cookieJar }
//     );

//     // Check if we have saved tokens
//     const hasTokens = auth.session.hasMetadata('outlookTokens');
//     const tokenExpiry = auth.session.getMetadata('outlookTokensExpiry');
//     const tokensValid = hasTokens && tokenExpiry && Date.now() < tokenExpiry - 300000;

//     if (!tokensValid) {
//         console.log('No valid tokens, performing authentication...');
//         const result = await auth.login(['OUTLOOK']);

//         if (!result.success) {
//             return { success: false, error: result.error };
//         }

//         // Save updated cookie jar with new tokens
//         await updateAccountCookies(account.email, auth.session.exportCookieJar());
//     } else {
//         console.log('Using saved tokens');
//         auth.apiTokens = auth.session.getMetadata('outlookTokens');
//         auth.mailboxValue = auth.session.getMetadata('mailboxValue');
//     }

//     // Perform Outlook operations
//     try {
//         const messages = await makeOutlookApiCall(
//             auth.apiTokens.access_token,
//             auth.mailboxValue
//         );

//         console.log(`Retrieved ${messages.value.length} messages`);

//         return {
//             success: true,
//             messageCount: messages.value.length,
//             tokens: {
//                 expiresAt: new Date(tokenExpiry)
//             }
//         };
//     } catch (error) {
//         if (error.response?.status === 401) {
//             // Token expired, trigger re-authentication
//             console.log('Token expired during use, re-authenticating...');
//             await auth.login(['OUTLOOK']);
//             await updateAccountCookies(account.email, auth.session.exportCookieJar());

//             // Retry the operation
//             return completeWorkflowWithTokens(accountData);
//         }

//         throw error;
//     }
// }