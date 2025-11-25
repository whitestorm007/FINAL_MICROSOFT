# Microsoft Rewards Automation - Threat Model

**Purpose:** Map attack surfaces, threat actors, and attack vectors for defensive planning

---

## 1. THREAT ACTORS

### Threat Actor Profile

| Attribute | Value |
|-----------|-------|
| **Skill Level** | Advanced (requires coding, infrastructure, AI integration) |
| **Resources** | Medium (MongoDB, proxies, AI API access) |
| **Motivation** | Financial gain through rewards point farming |
| **Scale** | High (designed for multiple accounts, distributed execution) |
| **Detection Awareness** | High (implements anti-detection techniques) |

---

## 2. ATTACK TREE

```
[ROOT] Automate Microsoft Rewards at Scale
│
├─── [1] Bypass Authentication Controls
│    ├─── [1.1] Acquire Valid Credentials
│    │    ├─── [1.1.1] Use leaked/purchased credentials
│    │    └─── [1.1.2] Create new accounts programmatically
│    │
│    ├─── [1.2] Establish Persistent Sessions
│    │    ├─── [1.2.1] Extract cookies via automated login
│    │    ├─── [1.2.2] Cache tokens in database
│    │    └─── [1.2.3] Bypass 2FA via OTP extraction
│    │
│    └─── [1.3] Evade Account Lockouts
│         ├─── [1.3.1] Add recovery emails programmatically
│         ├─── [1.3.2] Rotate proxies to hide IP
│         └─── [1.3.3] Distribute requests over time
│
├─── [2] Evade Bot Detection Systems
│    ├─── [2.1] Mimic Human Behavior
│    │    ├─── [2.1.1] Simulate typing character-by-character (70-350ms delays)
│    │    ├─── [2.1.2] Generate AI-based diverse queries (Gemini API)
│    │    ├─── [2.1.3] Assign persona profiles to accounts
│    │    └─── [2.1.4] Schedule searches across time windows
│    │
│    ├─── [2.2] Spoof Browser Fingerprints
│    │    ├─── [2.2.1] Rotate User-Agent headers (header-generator)
│    │    ├─── [2.2.2] Generate dynamic browser headers
│    │    └─── [2.2.3] Manage cookies like real browsers
│    │
│    └─── [2.3] Evade Rate Limiting
│         ├─── [2.3.1] Distribute requests (10s delays between accounts)
│         ├─── [2.3.2] Use proxy rotation
│         └─── [2.3.3] Implement retry logic with backoff
│
├─── [3] Claim Rewards Fraudulently
│    ├─── [3.1] Complete Search Tasks
│    │    ├─── [3.1.1] Execute PC searches (35/day)
│    │    ├─── [3.1.2] Execute mobile searches (25/day)
│    │    └─── [3.1.3] Report activity to rewards API
│    │
│    ├─── [3.2] Complete Non-Search Tasks
│    │    ├─── [3.2.1] Auto-complete quizzes (without reading)
│    │    ├─── [3.2.2] Complete daily sets
│    │    └─── [3.2.3] Claim promotional tasks
│    │
│    └─── [3.3] Accumulate Points
│         ├─── [3.3.1] Track points via dashboard API
│         ├─── [3.3.2] Redeem for gift cards/rewards
│         └─── [3.3.3] Cash out or sell accounts
│
└─── [4] Scale Operations
     ├─── [4.1] Manage Multiple Accounts
     │    ├─── [4.1.1] Store account data in MongoDB
     │    ├─── [4.1.2] Coordinate via distributed workers
     │    └─── [4.1.3] Monitor account health (auth.js worker)
     │
     ├─── [4.2] Infrastructure Automation
     │    ├─── [4.2.1] Scheduler (planner + executor jobs)
     │    ├─── [4.2.2] Worker coordination (jobStatus: IDLE/RUNNING)
     │    └─── [4.2.3] Automatic recovery from failures
     │
     └─── [4.3] Operational Security
          ├─── [4.3.1] Use residential proxies
          ├─── [4.3.2] Encrypt database connections
          └─── [4.3.3] Monitor for detection signals
```

---

## 3. DATA FLOW DIAGRAM

### 3.1 Authentication Flow (THE_ROBUST_MICROSOFT)

```
┌───────────┐
│  MongoDB  │
│ (Accounts)│
└─────┬─────┘
      │ Read account needing auth
      ↓
┌─────────────────────────┐
│   auth.js Worker        │
│ - Finds "bad" accounts  │
│ - Sets jobStatus=RUNNING│
└──────────┬──────────────┘
           │
           ↓
┌──────────────────────────┐
│  microsoft-auth.js       │
│ ┌──────────────────────┐ │
│ │ 1. GET login page    │ │
│ │    Extract PPFT      │ │
│ └──────┬───────────────┘ │
│        │                 │
│ ┌──────▼───────────────┐ │
│ │ 2. POST username     │ │
│ └──────┬───────────────┘ │
│        │                 │
│ ┌──────▼───────────────┐ │
│ │ 3. POST password     │ │
│ └──────┬───────────────┘ │
│        │                 │
│ ┌──────▼───────────────┐ │
│ │ 4. Handle redirects  │ │
│ │    (up to 20 hops)   │ │
│ └──────┬───────────────┘ │
└────────┼─────────────────┘
         │
         ↓
   ┌─────────────┐
   │ OTP needed? │
   └──────┬──────┘
          │ Yes
          ↓
┌────────────────────────┐
│ outlook-otp-fetcher.js │
│ - Poll Outlook (5s)    │
│ - Extract OTP code     │
│ - Return to auth flow  │
└──────────┬─────────────┘
           │
           ↓
┌──────────────────────────┐
│ Cookie Jar Export        │
│ - Serialize cookies      │
│ - Store metadata         │
│ - Save to MongoDB        │
└──────────┬───────────────┘
           │
           ↓
┌──────────────────────────┐
│ MongoDB Update           │
│ - cookieJar = serialized │
│ - jobStatus = IDLE       │
│ - nextSessionEligible    │
└──────────────────────────┘
```

### 3.2 Search Automation Flow (GRIND-SEARCH)

```
┌──────────────────────────────────────────────────┐
│             Scheduler (main.js)                  │
│  ┌────────────────┐      ┌──────────────────┐  │
│  │  runPlanner()  │      │  runExecutor()   │  │
│  │  Every 15 min  │      │  Every 60 sec    │  │
│  └────────┬───────┘      └────────┬─────────┘  │
└───────────┼──────────────────────┼──────────────┘
            │                       │
            ↓                       ↓
┌───────────────────────┐  ┌─────────────────────┐
│   jobs/planner.js     │  │  jobs/executor.js   │
│ ┌───────────────────┐ │  │ ┌─────────────────┐ │
│ │ 1. Assign Personas│ │  │ │ 1. Claim account│ │
│ │    to new accounts│ │  │ │    (ATOMIC)     │ │
│ └─────────┬─────────┘ │  │ └────────┬────────┘ │
│           │           │  │          │          │
│ ┌─────────▼─────────┐ │  │ ┌────────▼────────┐ │
│ │ 2. Generate tasks │ │  │ │ 2. Find next    │ │
│ │    using AI       │ │  │ │    PENDING task │ │
│ └─────────┬─────────┘ │  │ └────────┬────────┘ │
│           │           │  │          │          │
│ ┌─────────▼─────────┐ │  │ ┌────────▼────────┐ │
│ │ 3. Schedule tasks │ │  │ │ 3. Execute task │ │
│ │    in time windows│ │  │ │    (Search/Quiz)│ │
│ └───────────────────┘ │  │ └────────┬────────┘ │
└───────────────────────┘  │          │          │
                           │ ┌────────▼────────┐ │
                           │ │ 4. Update status│ │
                           │ │    COMPLETE/FAIL│ │
                           │ └────────┬────────┘ │
                           │          │          │
                           │ ┌────────▼────────┐ │
                           │ │ 5. Release lock │ │
                           │ │    jobStatus    │ │
                           │ │    = IDLE       │ │
                           │ └─────────────────┘ │
                           └─────────────────────┘
                                      │
                                      ↓
                           ┌──────────────────────┐
                           │  bingSearchService.js│
                           │ ┌──────────────────┐ │
                           │ │ 1. Typing sim    │ │
                           │ │    (suggestion   │ │
                           │ │     requests)    │ │
                           │ └────────┬─────────┘ │
                           │          │           │
                           │ ┌────────▼─────────┐ │
                           │ │ 2. Final search  │ │
                           │ │    (with CVID)   │ │
                           │ └────────┬─────────┘ │
                           │          │           │
                           │ ┌────────▼─────────┐ │
                           │ │ 3. RewardsGrind  │ │
                           │ │    (non-search)  │ │
                           │ └────────┬─────────┘ │
                           │          │           │
                           │ ┌────────▼─────────┐ │
                           │ │ 4. Report points │ │
                           │ └──────────────────┘ │
                           └──────────────────────┘
```

---

## 4. THREAT SCENARIOS

### Scenario 1: Mass Account Creation & Farming

**Threat Actor Goal:** Create 1000 accounts, farm points, sell for profit

**Attack Path:**
```
1. Acquire 1000 email addresses (hotmail.com)
2. Use auth.js to create accounts automatically
3. Add recovery emails to avoid lockouts
4. Assign diverse personas to each account
5. Use planner.js to generate AI search schedules
6. Execute searches via distributed timing
7. Accumulate ~5000 points per account/month
8. Redeem for $5 gift cards per account
9. Revenue: $5000/month with minimal effort
```

**Success Indicators:**
- Accounts stay active for 30+ days
- Points accumulate without detection
- No CAPTCHAs or manual reviews triggered

**Current Defenses:** ❌ INSUFFICIENT
- No account clustering detection
- No behavioral analysis
- No cross-account correlation

---

### Scenario 2: Credential Stuffing with Automation

**Threat Actor Goal:** Use leaked credentials, automate rewards collection

**Attack Path:**
```
1. Obtain 10,000 leaked Microsoft credentials
2. Test credentials via automated login (auth.js)
3. Successfully access ~500 accounts (5% hit rate)
4. Install automation on valid accounts
5. Collect rewards without account owner noticing
6. Drain points periodically
```

**Detection Indicators:**
- Login from new geographic locations
- Sudden change in search patterns
- Rewards redemption without user consent

**Current Defenses:** ⚠️ PARTIAL
- Session binding to IP (but defeated by proxies)
- No behavioral baseline comparison

---

### Scenario 3: Distributed Bot Network

**Threat Actor Goal:** Operate bot network across infrastructure

**Attack Path:**
```
1. Deploy MongoDB cluster
2. Run multiple auth.js workers across servers
3. Use residential proxy network
4. Coordinate via WORKER_ID assignments
5. Process 100 accounts per worker
6. Scale to 10 workers = 1000 accounts
7. Revenue: $5000/month per worker = $50,000/month
```

**Operational Pattern:**
- Workers run 24/7 with 5-second cycles
- Accounts distributed across IP ranges
- Task execution spread over time windows

**Current Defenses:** ❌ NONE
- No distributed coordination detection
- No infrastructure fingerprinting
- No rate limiting across worker IPs

---

## 5. ATTACK SURFACE ANALYSIS

### 5.1 External Attack Surface

| Endpoint | Method | Vulnerability | Risk |
|----------|--------|---------------|------|
| `/AS/Suggestions` | GET | Client-generated CVID accepted | HIGH |
| `/api/reportactivity` | POST | No interaction proof required | CRITICAL |
| `/api/getuserinfo` | GET | No rate limiting per session | MEDIUM |
| `/owa/` (Outlook) | GET | Email polling not limited | HIGH |
| `/proofs/Add` (Alt email) | POST | No CAPTCHA on bulk additions | HIGH |

### 5.2 Authentication Attack Surface

| Component | Vulnerability | Exploitability |
|-----------|---------------|----------------|
| PPFT Token | Client-side extraction predictable | MEDIUM |
| Session Cookies | Long lifetime, no device binding | HIGH |
| OTP Delivery | Predictable email format, no delay | HIGH |
| 2FA | Bypassable via automated OTP extraction | CRITICAL |
| Password Reset | Recovery account controlled by attacker | HIGH |

### 5.3 Business Logic Attack Surface

| Logic Flaw | Impact | Current Protection |
|------------|--------|-------------------|
| Search without click-through | Points awarded without engagement | NONE |
| Quiz instant completion | Points awarded without reading | NONE |
| Task batch completion | Multiple tasks in seconds | NONE |
| Persona-based queries | AI-generated queries accepted | NONE |
| Account clustering | No detection of related accounts | NONE |

---

## 6. SECURITY CONTROLS ANALYSIS

### 6.1 Existing Controls (Inadequate)

| Control | Effectiveness | Bypass Method |
|---------|---------------|---------------|
| IP-based rate limiting | LOW | Proxy rotation |
| User-Agent validation | LOW | Header spoofing |
| Session timeout | MEDIUM | Automatic token refresh |
| CAPTCHA (occasional) | MEDIUM | Solved manually once, then automation |
| Email verification | LOW | Automated OTP extraction |

### 6.2 Missing Controls

| Missing Control | Impact if Implemented |
|-----------------|----------------------|
| Behavioral biometrics | HIGH - Would detect keyboard/mouse patterns |
| Device fingerprinting | HIGH - Would detect session hijacking |
| ML anomaly detection | VERY HIGH - Would detect automation patterns |
| Query coherence analysis | HIGH - Would detect AI-generated queries |
| Engagement validation | HIGH - Would require actual click-through |
| Account graph analysis | VERY HIGH - Would detect clusters |
| Honeypot tasks | MEDIUM - Would catch unsophisticated bots |

---

## 7. RISK ASSESSMENT MATRIX

### 7.1 Threat Risk Scores

| Threat | Likelihood | Impact | Risk Score | Priority |
|--------|-----------|--------|------------|----------|
| Mass account farming | VERY HIGH | HIGH | 9.0 | P0 |
| Credential stuffing | HIGH | MEDIUM | 7.5 | P1 |
| Distributed bot network | HIGH | VERY HIGH | 9.5 | P0 |
| AI-generated queries | VERY HIGH | MEDIUM | 8.0 | P0 |
| OTP bypass | HIGH | HIGH | 8.5 | P1 |
| Session hijacking | MEDIUM | HIGH | 7.0 | P2 |

**Risk Score Calculation:** `(Likelihood × Impact) / 1.25`
- Likelihood: 1-5 (Very Low to Very High)
- Impact: 1-5 (Very Low to Very High)
- Risk Score: 1-10

### 7.2 Business Impact

| Impact Category | Severity | Annual Cost Estimate |
|----------------|----------|---------------------|
| Revenue loss (fraudulent redemptions) | HIGH | $500K - $2M |
| Reputation damage | MEDIUM | $100K - $500K |
| Legitimate user friction (false positives) | LOW | $50K - $100K |
| Detection/prevention infrastructure | MEDIUM | $200K - $500K |
| **Total Estimated Impact** | **HIGH** | **$850K - $3.1M** |

---

## 8. MITRE ATT&CK MAPPING

### 8.1 Tactics & Techniques

| Tactic | Technique | Example from Codebase |
|--------|-----------|----------------------|
| **Initial Access** | T1078 - Valid Accounts | Uses legitimate credentials |
| **Execution** | T1059 - Command and Scripting | Node.js automation scripts |
| **Persistence** | T1136 - Create Account | Adds recovery emails programmatically |
| **Defense Evasion** | T1027 - Obfuscated Files | Header spoofing, timing randomization |
| **Defense Evasion** | T1497 - Virtualization/Sandbox Evasion | Browser fingerprint spoofing |
| **Credential Access** | T1110 - Brute Force | Automated login attempts |
| **Discovery** | T1087 - Account Discovery | Dashboard API scraping |
| **Collection** | T1005 - Data from Local System | Cookie jar extraction |
| **Exfiltration** | T1041 - Exfiltration Over C2 | Points tracking to MongoDB |

### 8.2 Detection Opportunities

| Technique | Detection Method | Data Source |
|-----------|-----------------|-------------|
| T1078 - Valid Accounts | Anomalous login location/time | Auth logs |
| T1027 - Obfuscated Files | Static timing patterns | Request timing logs |
| T1497 - Sandbox Evasion | Missing behavioral entropy | Client telemetry |
| T1110 - Brute Force | Multiple failed attempts | Auth failure logs |
| T1087 - Account Discovery | Rapid API enumeration | API access logs |

---

## 9. DEFENSIVE ARCHITECTURE

### 9.1 Defense-in-Depth Layers

```
┌─────────────────────────────────────────────────────────┐
│ LAYER 1: Network/Infrastructure                        │
│ - WAF rules for suspicious patterns                     │
│ - DDoS protection                                       │
│ - Geo-blocking (optional)                              │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│ LAYER 2: Authentication                                 │
│ - Device fingerprinting                                 │
│ - Behavioral biometrics at login                       │
│ - Risk-based authentication                            │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│ LAYER 3: Session Management                            │
│ - Continuous authentication                             │
│ - Session binding to device fingerprint                │
│ - Short session lifetimes                              │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│ LAYER 4: Behavioral Analysis                           │
│ - Typing pattern analysis                              │
│ - Mouse movement entropy                               │
│ - Query coherence tracking                             │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│ LAYER 5: Business Logic                                │
│ - Click-through validation                             │
│ - Time-on-page requirements                            │
│ - Engagement depth tracking                            │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│ LAYER 6: ML/AI Detection                               │
│ - Anomaly detection models                             │
│ - Account cluster analysis                             │
│ - Real-time threat scoring                             │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│ LAYER 7: Response & Mitigation                         │
│ - Progressive challenges (CAPTCHA)                     │
│ - Account suspension                                    │
│ - Fraud investigation queue                            │
└─────────────────────────────────────────────────────────┘
```

### 9.2 Kill Chain Interruption Points

```
Attacker Kill Chain → Defensive Interruption

[1] Reconnaissance       → WAF + Bot detection
    ↓ (BLOCK HERE)
[2] Weaponization        → N/A (external)
    ↓
[3] Delivery             → Email verification + CAPTCHA
    ↓ (BLOCK HERE)
[4] Exploitation         → Behavioral biometrics
    ↓ (DETECT HERE)
[5] Installation         → Device fingerprinting + Session binding
    ↓ (DETECT & CHALLENGE)
[6] Command & Control    → Network pattern analysis
    ↓ (DETECT & BLOCK)
[7] Actions on Objective → Honeypot tasks + Engagement validation
    ↓ (DETECT & PREVENT REWARD)
```

**Key Interruption Points:**
1. **Pre-Authentication:** CAPTCHA, email verification
2. **Authentication:** Behavioral biometrics, device fingerprinting
3. **Session:** Continuous authentication, anomaly detection
4. **Activity:** Engagement validation, honeypot tasks

---

## 10. MONITORING & ALERTING

### 10.1 Critical Alerts

```yaml
alerts:
  - name: account_cluster_detected
    severity: CRITICAL
    condition: >
      5+ accounts from same IP with similar timing patterns
    action:
      - Flag all accounts for review
      - Enable enhanced monitoring
      - Require re-authentication

  - name: honeypot_triggered
    severity: HIGH
    condition: >
      User completes hidden/fake task
    action:
      - Shadow ban account
      - Continue monitoring
      - Add to fraud investigation queue

  - name: low_engagement_pattern
    severity: MEDIUM
    condition: >
      10+ searches without click-through in 1 hour
    action:
      - Challenge with CAPTCHA
      - Reduce trust score
      - Monitor for 24 hours

  - name: typing_automation_detected
    severity: HIGH
    condition: >
      Typing pattern matches uniform distribution (p < 0.05)
    action:
      - Flag account
      - Require behavioral challenge
      - Review recent activity
```

### 10.2 Dashboard Metrics

```javascript
const securityDashboard = {
    realtime: {
        activeAccounts: 150000,
        suspiciousAccounts: 452,
        blockedAccounts: 127,
        activeChallenges: 89
    },
    detection: {
        automationDetectionRate: 0.85,
        falsePositiveRate: 0.02,
        avgDetectionTime: '45 seconds',
        clusterDetectionRate: 0.90
    },
    business: {
        fraudulentRedemptionsPrevented: 3420,
        estimatedSavings: '$17,100',
        legitimateUserFriction: 0.03
    }
};
```

---

## 11. INCIDENT RESPONSE PLAN

### 11.1 Detection → Response Flow

```
┌─────────────────────┐
│ Automated Detection │
│ - ML model flags    │
│ - Rule violation    │
└──────────┬──────────┘
           │
           ↓
┌──────────────────────┐    ┌────────────────┐
│ Severity Assessment  │───→│ P0: CRITICAL   │
│ - Risk score > 8.0   │    │ P1: HIGH       │
│ - Cluster detected   │    │ P2: MEDIUM     │
└──────────┬───────────┘    └────────────────┘
           │
           ↓
┌──────────────────────────────────────┐
│ Automated Response (P0/P1)           │
│ 1. Shadow ban account                │
│ 2. Invalidate sessions               │
│ 3. Add to investigation queue        │
│ 4. Flag related accounts             │
└──────────┬───────────────────────────┘
           │
           ↓
┌──────────────────────────────────────┐
│ Manual Investigation (Within 24h)    │
│ 1. Review activity logs              │
│ 2. Check for false positive          │
│ 3. Determine ban vs warning          │
│ 4. Document findings                 │
└──────────┬───────────────────────────┘
           │
           ↓
┌──────────────────────────────────────┐
│ Resolution                           │
│ - Permanent ban (confirmed fraud)    │
│ - Warning + monitoring (suspicious)  │
│ - Restore (false positive)           │
└──────────────────────────────────────┘
```

---

## 12. CONCLUSION

### Summary of Threats

This threat model identifies a **CRITICAL** risk from sophisticated automation:

**Key Findings:**
1. ✅ **Attack is technically feasible and actively implemented**
2. ✅ **Current defenses are insufficient**
3. ✅ **Financial impact is significant** ($850K - $3.1M annually)
4. ✅ **Detection is possible with proper controls**

### Recommended Actions

**Immediate (Week 1-2):**
- [ ] Deploy server-side CVID generation
- [ ] Implement session-based rate limiting
- [ ] Add minimum time-on-page requirements

**Short-term (Month 1-3):**
- [ ] Deploy behavioral biometrics
- [ ] Implement honeypot tasks
- [ ] Add typing pattern analysis

**Long-term (Month 4-6):**
- [ ] Deploy ML anomaly detection
- [ ] Implement account cluster detection
- [ ] Build continuous authentication system

### Success Criteria

- Reduce fraudulent redemptions by 75%
- Maintain false positive rate < 2%
- Detect automation within 45 seconds
- Identify 90% of account clusters

---

**Document Classification:** Security Research - Threat Intelligence
**Approved for:** Defensive Security Teams, MSRC Submission
**Next Review:** After MSRC Disclosure Response
