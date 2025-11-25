const { MicrosoftAuth, HttpSession } = require('./microsoft-auth');
const { OutlookOTPFetcher, createOTPFetcherFromCookieJar } = require('./outlook-otp-fetcher');

/**
 * Enhanced RedirectHandler with automatic OTP fetching
 */
class EnhancedRedirectHandler {
    constructor(config = {}) {
        this.config = config;
        this.NextUpdateTerm = false;
    }

    async analyzeRedirect(response, lastUrl) {
        const { status, headers, data } = response;
        const $ = require('cheerio').load(data || '');
        const HtmlParser = require('./microsoft-auth').HtmlParser;
        const serverData = HtmlParser.extractServerData(data);

        // Handle 302/301 redirects
        if ((status === 302 || status === 301) && headers.location) {
            return {
                type: 'HTTP_REDIRECT',
                url: this._resolveUrl(headers.location, lastUrl)
            };
        }

        // Handle "Object moved" pages
        if ($('title').text() === 'Object moved' && $('h2 > a[href]').length > 0) {
            const href = $('h2 > a').attr('href');
            return {
                type: 'MANUAL_REDIRECT',
                url: this._resolveUrl(href, lastUrl)
            };
        }

        // Handle auto-submit forms
        const autoForm = $('form#fmHF[name="fmHF"]');
        if (autoForm.length > 0 && $('body[onload*="DoSubmit"]').length > 0) {
            const formAction = autoForm.attr('action');
            if (formAction && formAction.includes('tou/accrue')) {
                this.NextUpdateTerm = true;
            }

            return {
                type: 'AUTO_SUBMIT',
                url: formAction,
                payload: this._extractFormData($, autoForm)
            };
        }

        // Handle proof freshness form
        const proofForm = $('form#fProofFreshness');
        if (proofForm.length > 0 && $('title').text().includes('security info')) {
            const payload = this._extractFormData($, proofForm);
            payload.ProofFreshnessAction = 1;
            return {
                type: 'AUTO_SUBMIT',
                url: proofForm.attr('action'),
                payload
            };
        }

        // Handle MSAL redirect
        if (data.includes("msalInstance")) {
            const metaTag = $('meta[http-equiv="refresh"]');
            if (metaTag.length > 0) {
                const content = metaTag.attr('content');
                const urlMatch = content?.match(/url=(.*)/i);
                if (urlMatch) {
                    return {
                        type: 'MSAL_REDIRECT',
                        url: urlMatch[1]
                    };
                }
            }
        }

        // Handle add proof form (recovery email)
        const frmAddProof = $('form#frmAddProof');
        if (status === 200 && frmAddProof && frmAddProof.length > 0 && $('title').text().includes('protect your account')) {
            try {
                const payload = this._extractFormData($, frmAddProof);

                if (!payload) {
                    throw new Error('Failed to extract form data');
                }

                payload.iProofOptions = "Email";
                payload.DisplayPhoneCountryISO = "US";
                payload.DisplayPhoneNumber = "";

                console.log('📧 Adding recovery email...');

                if (this.config.recoveryAccount && this.config.recoveryAccount.Add === true) {
                    if (!this.config.recoveryAccount.email) {
                        throw new Error('Recovery email not configured');
                    }
                    payload.action = "AddProof";
                    payload.EmailAddress = this.config.recoveryAccount.email;
                    console.log(`✅ Will add: ${this.config.recoveryAccount.email}`);
                } else {
                    payload.EmailAddress = "";
                    payload.action = "Skip";
                    console.log('⏭️  Skipping recovery email addition');
                }

                const formAction = frmAddProof.attr('action');
                if (!formAction) {
                    throw new Error('Form action URL not found');
                }

                return {
                    type: 'AUTO_SUBMIT',
                    url: formAction,
                    payload
                };

            } catch (error) {
                console.error('❌ Error processing add proof form:', error.message);
                throw error;
            }
        }

        // Handle Verify proof form (OTP input) - WITH AUTOMATIC OTP FETCHING
        const frmVerifyProof = $('form#frmVerifyProof');
        if (status === 200 && frmVerifyProof.length > 0 && $('title').text().includes('Enter the code we sent to')) {

            const titleText = $('title').text();
            console.log(`\n🔐 ${titleText}`);

            let otp;

            // Try automatic OTP fetching if recovery account credentials provided
            if (this.config.recoveryAccount?.cookieJar || this.config.recoveryAccount?.session) {
                try {
                    console.log('🤖 Attempting automatic OTP fetch...');
                    
                    let otpFetcher;
                    if (this.config.recoveryAccount.cookieJar) {
                        otpFetcher = createOTPFetcherFromCookieJar(this.config.recoveryAccount.cookieJar);
                    } else if (this.config.recoveryAccount.session) {
                        const tokens = this.config.recoveryAccount.session.getMetadata('outlookTokens');
                        const mailbox = this.config.recoveryAccount.session.getMetadata('mailboxValue');
                        otpFetcher = new OutlookOTPFetcher(tokens.access_token, mailbox);
                    }

                    console.log("Wait for OTP email to arrive");
                    // Wait for OTP email to arrive
                    const result = await otpFetcher.waitForOTP({
                        initialDelay: 2000,
                        timeout: 120000, // 2 minutes
                        pollInterval: 5000, // Check every 5 seconds
                        maxAge: 300000 // Accept emails from last 5 minutes
                    });

                    if (result.success) {
                        otp = result.otp;
                        console.log(`✅ OTP automatically fetched: ${otp}`);
                        console.log(`📨 From: ${result.email.subject}`);
                        console.log(`⏰ Received: ${result.email.deliveryTime}`);
                    } else {
                        console.log(`⚠️  Automatic fetch failed: ${result.error}`);
                        console.log('💬 Falling back to manual input...');
                        throw new Error('💬 Falling back to manual input...');
                        // otp = await this._manualOTPInput(`Enter OTP code: `);
                    }

                } catch (error) {
                    console.error(`❌ Auto-fetch error: ${error.message}`);
                    console.log('💬 Falling back to manual input...');
                    throw new Error('💬 Falling back to manual input...');

                }
            } else {
                console.log('💬 Manual OTP input (no recovery account session provided)');
                throw new Error('💬 Falling back to manual input...');

            }

            const payload = this._extractFormData($, frmVerifyProof);

            if (!this.config.recoveryAccount || !this.config.recoveryAccount.email) {
                throw new Error('Recovery email not configured for OTP verification');
            }

            payload.iProofOptions = `OTT||${this.config.recoveryAccount.email}||Email||0||o`;
            payload.iOttText = otp;
            payload.GeneralVerify = 0;

            return {
                type: 'AUTO_SUBMIT',
                log:true,
                url: frmVerifyProof.attr('action'),
                payload
            };
        }

        // Handle terms update
        if (status === 200 && this.NextUpdateTerm === true && serverData?.sCanary !== undefined) {
            try {
                const encoded = serverData.sCanary;
                const decoded = JSON.parse(`"${encoded}"`);
                const url = serverData.urlRU;

                if (!url) {
                    throw new Error('Terms update URL not found');
                }

                const payload = {
                    canary: decoded
                };

                return {
                    type: 'AUTO_SUBMIT',
                    url: url,
                    payload
                };
            } catch (error) {
                console.error('Error processing terms update:', error.message);
                throw error;
            }
        }

        // Handle password entry
        if (status === 200 && $('title').text().includes('Sign in to your Microsoft account') && serverData?.sSignInUsername) {
            const HtmlParser = require('./microsoft-auth').HtmlParser;
            const PPFT = HtmlParser.extractFlowToken(serverData);

            if (!PPFT) {
                throw new Error('Flow token (PPFT) not found');
            }

            if (!serverData.urlPost) {
                throw new Error('Post URL not found for password entry');
            }

            const payload = { PPFT };

            return {
                type: 'ENTER_PASSWORD',
                url: serverData.urlPost,
                payload
            };
        }

        // Final page
        if (status === 200) {
            return { type: 'FINAL_PAGE' };
        }

        return { type: 'UNKNOWN' };
    }

    async _manualOTPInput(prompt) {
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise(resolve => {
            rl.question(prompt, (answer) => {
                rl.close();
                resolve(answer.trim());
            });
        });
    }

    _extractFormData($, form) {
        const data = {};
        form.find('input[type="hidden"]').each((i, el) => {
            const name = $(el).attr('name');
            const value = $(el).attr('value');
            if (name) {
                data[name] = value || '';
            }
        });
        return data;
    }

    _resolveUrl(url, baseUrl) {
        if (!url) return null;
        if (url.startsWith('http')) return url;
        if (url.startsWith('/') && baseUrl) {
            try {
                return new URL(url, baseUrl).href;
            } catch {
                return null;
            }
        }
        return url;
    }
}

/**
 * Usage example with automatic OTP
 */
async function loginWithAutomaticOTP() {
    // First, authenticate the recovery account to get its session
    const recoveryAuth = new MicrosoftAuth(
        { 
            email: 'recovery@hotmail.com', 
            password: 'recoverypass' 
        }
    );

    console.log('🔑 Authenticating recovery account...');
    const recoveryResult = await recoveryAuth.login(['OUTLOOK']);
    
    if (!recoveryResult.success) {
        console.error('❌ Failed to authenticate recovery account');
        return;
    }

    console.log('✅ Recovery account authenticated');

    // Now authenticate main account with recovery account session
    const mainAuth = new MicrosoftAuth(
        { 
            email: 'main@hotmail.com', 
            password: 'mainpass' 
        },
        {
            recoveryAccount: {
                Add: true,
                email: 'recovery@hotmail.com',
                password: 'recoverypass',
                // Pass the authenticated session for automatic OTP fetching
                session: recoveryAuth.session
                // OR pass the cookie jar string:
                // cookieJar: recoveryResult.cookieJar
            }
        }
    );

    console.log('\n🔑 Authenticating main account...');
    const mainResult = await mainAuth.login(['ALL', 'OUTLOOK', 'REWARDS']);

    if (mainResult.success) {
        console.log('✅ Main account authenticated successfully!');
        console.log('📦 Cookies:', mainResult.cookies);
    } else {
        console.error('❌ Main account authentication failed:', mainResult.error);
    }
}

module.exports = {
    EnhancedRedirectHandler,
    loginWithAutomaticOTP
};