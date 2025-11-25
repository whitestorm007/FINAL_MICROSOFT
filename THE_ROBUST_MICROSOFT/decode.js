const crypto = require("crypto");
const {URL, URLSearchParams} = require("url");

/**
 * Generates a complete, Microsoft-compatible authentication URL and the necessary secrets to be saved.
 * This function mimics the cryptographic and formatting standards of MSAL.js v2.37.0.
 *
 * @param {object} config - The configuration for the authentication request.
 * @param {string} config.clientId - The Application (client) ID.
 * @param {string} config.authority - The authority URL (e.g., "https://login.microsoftonline.com/consumers").
 * @param {string} config.redirectUri - The configured Redirect URI for your application.
 * @param {string} config.loginHint - The user's email or username.
 * @param {string[]} [config.scopes] - Optional scopes. Defaults to ["openid", "profile", "offline_access"].
 * @param {string} [config.prompt="none"] - The prompt behavior. "none" for silent, "login" for interactive.
 * @returns {{
 * redirectUrl: string,
 * requestContext: {
 * codeVerifier: string,
 * state: string,
 * nonce: string,
 * correlationId: string
 * }
 * }} An object with the final URL and the context that MUST be saved in the user's session.
 */
function createMicrosoftAuthUrl(config) {
  // --- Internal Helper Functions to mimic MSAL's crypto operations ---

  const base64UrlEncode = (buffer) =>
    buffer
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

  const createNewGuid = () => {
    const buffer = crypto.randomBytes(16);
    buffer[6] = (buffer[6] & 0x0f) | 0x40; // Version 4
    buffer[8] = (buffer[8] & 0x3f) | 0x80; // Variant RFC 4122
    const hex = buffer.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16
    )}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  };

  // --- 1. Generate Dynamic Cryptographic Values ---

  const nonce = createNewGuid();
  const correlationId = createNewGuid();

  // MSAL-compatible state with a unique ID and interaction metadata
  const msalInternalState = {
    id: createNewGuid(),
    meta: {interactionType: config.prompt === "none" ? "silent" : "redirect"},
  };
  const state = Buffer.from(JSON.stringify(msalInternalState)).toString(
    "base64"
  );

  // PKCE Code Verifier (32 random bytes, base64url encoded)
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));

  // PKCE Code Challenge (SHA256 hash of verifier, base64url encoded)
  const codeChallenge = base64UrlEncode(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );

  // --- 2. Construct the URL with all required parameters ---

  // const authEndpoint = new URL(`${config.authority}/oauth2/v2.0/authorize`);

  // const params = new URLSearchParams({
  //     // --- Standard OAuth2 & OpenID Connect Parameters ---
  //     client_id: config.clientId,
  //     scope: (config.scopes || ["service::outlook.office.com::MBI_SSL", "openid", "profile", "offline_access"]).join(" "),
  //     redirect_uri: config.redirectUri,
  //     "client-request-id": correlationId,
  //     response_mode: 'fragment', // Used for silent iframe flows
  //     client_info: "1",
  //     prompt: config.prompt || "none",
  //     nonce: nonce,
  //     state: state,
  //     claims: { "access_token": { "xms_cc": { "values": ["CP1"] } } },
  //     "x-client-SKU": "msal.js.browser",
  //     "x-client-VER": "4.14.0",
  //     response_type: 'code',
  //     login_hint: config.loginHint,
  //     code_challenge: codeChallenge,
  //     // --- PKCE Parameters ---
  //     code_challenge_method: 'S256',

  //     // --- MSAL.js v2.37.0 "Fingerprint" Parameters ---
  //     "X-AnchorMailbox": `UPN:${config.loginHint}`,
  // });

  // authEndpoint.search = params.toString();

  // // --- 3. Return the final URL and secrets ---
  // return {
  //     redirectUrl: authEndpoint.href,
  //     requestContext: {
  //         codeVerifier,
  //         state,
  //         nonce,
  //         correlationId,
  //         params,
  //         scopes: (config.scopes || ["service::outlook.office.com::MBI_SSL", "openid", "profile", "offline_access"]).join(" ")
  //     },
  // };
  const authEndpoint = new URL(`${config.authority}/oauth2/v2.0/authorize`);

  const paramsObject = {
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: (
      config.scopes || [
        "service::outlook.office.com::MBI_SSL",
        "openid",
        "profile",
        "offline_access",
      ]
    ).join(" "),
    state: state,
    nonce: nonce,
    prompt: config.prompt || "none",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    response_mode: config.response_mode || "fragment",
    "client-request-id": correlationId,
    "x-client-SKU": config["x-client-SKU"] || "msal.js.browser",
    "x-client-VER": config["x-client-VER"] || "4.14.0",
    client_info: "1",
  };

  // --- MODIFICATION START ---
  // Conditionally add login_hint and related parameters
  if (config.loginHint) {
    paramsObject.login_hint = config.loginHint;
    paramsObject["X-AnchorMailbox"] = `UPN:${config.loginHint}`;
  }
  // --- MODIFICATION END ---

  const params = new URLSearchParams(paramsObject);
  authEndpoint.search = params.toString();

  // --- 3. Return the final URL and secrets (no changes here) ---
  return {
    redirectUrl: authEndpoint.href,
    requestContext: {
      codeVerifier,
      state,
      nonce,
      correlationId,
      params,
      scopes: (
        config.scopes || [
          "service::outlook.office.com::MBI_SSL",
          "openid",
          "profile",
          "offline_access",
        ]
      ).join(" "),
    },
  };
}

// --- HOW TO USE IT ---

// 1. Define your application's configuration

// 2. Generate the URL and the secrets
// const { redirectUrl, requestContext } = createMicrosoftAuthUrl(msalConfig);

module.exports.createMicrosoftAuthUrl = createMicrosoftAuthUrl;
// console.log("✅ Generated Microsoft Authentication URL");
// console.log("------------------------------------------");
// console.log("Redirect URL (Send user here):", redirectUrl);
// console.log("\n🚨 IMPORTANT: You MUST save this context in the user's session:");
// console.log(requestContext);

// In a real application, the next step would be:
// 1. Save `requestContext` to the user's session (e.g., req.session.msalContext = requestContext).
// 2. Redirect the user's browser (or a hidden iframe) to the `redirectUrl`.

var data = {
  token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  token_endpoint_auth_methods_supported: [
    "client_secret_post",
    "private_key_jwt",
    "client_secret_basic",
  ],
  jwks_uri: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
  response_modes_supported: ["query", "fragment", "form_post"],
  subject_types_supported: ["pairwise"],
  id_token_signing_alg_values_supported: ["RS256"],
  response_types_supported: [
    "code",
    "id_token",
    "code id_token",
    "id_token token",
  ],
  scopes_supported: ["openid", "profile", "email", "offline_access"],
  issuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
  request_uri_parameter_supported: false,
  userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo",
  authorization_endpoint:
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  device_authorization_endpoint:
    "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode",
  http_logout_supported: true,
  frontchannel_logout_supported: true,
  end_session_endpoint:
    "https://login.microsoftonline.com/common/oauth2/v2.0/logout",
  claims_supported: [
    "sub",
    "iss",
    "cloud_instance_name",
    "cloud_instance_host_name",
    "cloud_graph_host_name",
    "msgraph_host",
    "aud",
    "exp",
    "iat",
    "auth_time",
    "acr",
    "nonce",
    "preferred_username",
    "name",
    "tid",
    "ver",
    "at_hash",
    "c_hash",
    "email",
  ],
  kerberos_endpoint: "https://login.microsoftonline.com/common/kerberos",
  tenant_region_scope: null,
  cloud_instance_name: "microsoftonline.com",
  cloud_graph_host_name: "graph.windows.net",
  msgraph_host: "graph.microsoft.com",
  rbac_url: "https://pas.windows.net",
};

// const msalConfig = {
//   clientId: "9199bf20-a13f-4107-85dc-02114787ef48",
//   authority: "https://login.microsoftonline.com/consumers",
//   redirectUri: "https://outlook.live.com/mail/oauthRedirect.html",
//   scopes: [
//       "service::outlook.office.com::MBI_SSL",
//       "openid",
//       "profile",
//       "offline_access"
//   ],
//   Origin: "https://outlook.live.com/",
//   prompt: "none"
// };
// console.log(createMicrosoftAuthUrl(msalConfig));
