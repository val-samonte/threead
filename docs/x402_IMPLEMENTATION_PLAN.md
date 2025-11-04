# x402 Standard Implementation Plan

**Date:** November 4, 2025  
**Status:** Planning Phase  
**Goal:** Refactor payment flow to follow x402 protocol standard (client-settled approach)

---

## Current Implementation Analysis

### Current Flow:
1. Client creates and **sends** transaction to blockchain
2. Client gets transaction signature
3. Client sends signature (`payment_tx`) to backend API
4. Backend verifies transaction is already on-chain
5. Backend processes ad

### Current Status:
✅ **CORRECT** - This matches the x402 template pattern:
- Client settles transaction first (via facilitator or directly)
- Backend only verifies (transaction already on-chain)
- No stale blockhash issues (transaction already settled)
- No server-side settlement needed

---

## x402 Standard Implementation (Based on Template)

### Standard Flow (Client-Settled Approach):
1. Client requests resource (ad creation)
2. Server responds with `402 Payment Required` + payment details
3. Client creates and **settles** payment transaction (via facilitator or directly)
4. Client gets transaction signature
5. Client sends transaction signature in `X-PAYMENT` header
6. **Server verifies transaction** (already on-chain)
7. Server checks for duplicate transaction (idempotency)
8. Server processes ad creation
9. Server rolls back if verification fails

### Key Differences from Previous Plan:
- ❌ **NO server-side settlement** - Client settles transaction first
- ❌ **NO stale blockhash issues** - Transaction already settled
- ❌ **NO transaction rebuilding** - Transaction already on-chain
- ✅ **VERIFICATION ONLY** - Server verifies already-settled transaction
- ✅ **IDEMPOTENCY** - Prevent duplicate ad creation from same transaction
- ✅ **REPLAY PROTECTION** - Prevent transaction signature reuse

---

## Required Changes

### 1. API Endpoint Changes

#### 1.1 Modify POST `/api/ads` Endpoint

**Current:** Accepts `payment_tx` in request body

**New:** 
- First request: Returns `402 Payment Required` with payment details
- Second request: Accepts `X-PAYMENT` header with transaction signature

**Payment Details Response (402):**
```json
{
  "paymentRequired": true,
  "paymentDetails": {
    "amount": "0.10",
    "currency": "USDC",
    "recipient": "treasury-token-account-address",
    "mint": "USDC_MINT_ADDRESS",
    "network": "devnet",
    "scheme": "exact",
    "facilitatorUrl": "https://x402.org/facilitator"
  }
}
```

**Payment Payload Format (Simplified):**
```json
{
  "transactionSignature": "5VERv8NMvzbJMEKV8ghdqxEdNd5d3okZcs5c1a16S45z9W4WSKxE2TG8Zn2vZv2XZ26poizCHY5vdYMBKCYeg4KG"
}
```

**Alternative: Transaction Signature in Header**
```http
X-PAYMENT: 5VERv8NMvzbJMEKV8ghdqxEdNd5d3okZcs5c1a16S45z9W4WSKxE2TG8Zn2vZv2XZ26poizCHY5vdYMBKCYeg4KG
```

---

### 2. Service Layer Changes

#### 2.1 Modify `services/createAdWithPayment.ts`

**Current Flow:**
```typescript
1. Extract payer from transaction signature
2. Check balance
3. Create ad (AI, DB, Vectorize)
4. Verify transaction (already on-chain)
5. Rollback if verification fails
```

**New Flow (Client-Settled Approach - VERIFY FIRST):**
```typescript
1. Extract payment signature from X-PAYMENT header or request body
2. Extract payer from transaction signature
3. VERIFY transaction FIRST (before expensive operations)
   - Check transaction exists and is confirmed
   - Check transaction succeeded (no errors)
   - Check payment amount matches expected
   - Check payment went to correct recipient
   - If verification fails → Return error immediately (no ad creation, no waste)
4. Check for duplicate transaction (idempotency check - after verification)
   - Query database for existing ad with same payment_tx
   - If duplicate → Return error (payment already used - like a ticket)
5. Check payer balance (early validation - redundant but useful for error messages)
6. Create ad (AI, DB, Vectorize) - Can take time (5-30 seconds)
   - AI moderation (expensive)
   - AI tagging (expensive)
   - DB insert with payment_tx (UNIQUE constraint prevents duplicates - safety net)
   - Vectorize indexing (expensive)
   - If duplicate key error → Return existing ad (409 Conflict) - should not happen normally
```

**Key Changes:**
- Accept transaction signature (not payment payload)
- **VERIFY payment FIRST** (before expensive operations - fail fast)
- Add idempotency check AFTER verification (check if payment_tx already exists)
  - If duplicate → Return error (payment already used - like a ticket)
- Balance check AFTER verification (early validation)
- Create ad AFTER verification and idempotency check succeeds
- **UNIQUE constraint on payment_tx** (database-level safety net - should not happen normally)
- No settlement needed (transaction already settled)
- **No rollback needed** (verification happens before ad creation)

#### 2.2 Add Idempotency Protection

**File:** `packages/backend/src/services/idempotency.ts` (new file)

**Functions:**
- `checkTransactionAlreadyProcessed(txSignature, env)` - Check if transaction was already used
- `markTransactionAsProcessed(txSignature, adId, env)` - Store transaction signature

**Implementation:**
```typescript
/**
 * Check if transaction signature was already processed
 * Prevents duplicate ad creation from same payment
 */
export async function checkTransactionAlreadyProcessed(
  txSignature: string,
  env: Env
): Promise<{ processed: boolean; existingAdId?: string }> {
  // Check database for existing ad with same payment_tx
  const existing = await env.DB.prepare(
    'SELECT ad_id FROM Ads WHERE payment_tx = ?'
  ).bind(txSignature).first<{ ad_id: string } | undefined>();
  
  if (existing) {
    return { processed: true, existingAdId: existing.ad_id };
  }
  
  return { processed: false };
}
```

#### 2.3 Modify `services/solana.ts`

**Keep Existing Functions:**
- `extractPayerFromTransaction()` - ✅ Keep (already correct)
- `verifyPayment()` - ✅ Keep (already correct)
- `verifyPaymentAndExtractPayer()` - ✅ Keep (already correct)

**No New Functions Needed:**
- ❌ No `settlePaymentTransaction()` - Client settles transaction
- ❌ No blockhash refresh - Transaction already settled
- ❌ No transaction rebuilding - Transaction already on-chain

---

### 3. Payment Flow Structure

#### 3.1 Define Payment Details Types

**File:** `packages/shared/src/types/payment.ts`

**Add:**
```typescript
export interface PaymentDetails {
  paymentRequired: boolean;
  paymentDetails: {
    amount: string; // USDC amount (e.g., "0.10")
    currency: string; // "USDC"
    recipient: string; // Treasury token account address
    mint: string; // USDC mint address
    network: 'devnet' | 'mainnet-beta';
    scheme: 'exact';
    facilitatorUrl?: string; // Optional facilitator URL
  };
}

export interface PaymentPayload {
  transactionSignature: string; // Solana transaction signature (base58)
}
```

---

### 4. Client-Side Payment Flow

#### 4.1 Client Flow (Matches x402 Template)

**Step 1: Request Resource**
```typescript
// Client sends request without payment
const response = await fetch('/api/ads', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Test Ad',
    description: 'Test description',
    days: 7
  })
});

// Server responds with 402 Payment Required
if (response.status === 402) {
  const paymentDetails = await response.json();
  // paymentDetails.paymentDetails contains amount, recipient, etc.
}
```

**Step 2: Client Settles Payment**
```typescript
// Client creates and sends payment transaction
// Option A: Via facilitator (like x402 template)
const facilitatorUrl = paymentDetails.paymentDetails.facilitatorUrl;
// Send payment to facilitator, facilitator settles transaction

// Option B: Direct settlement
const paymentTx = await createAndSendTokenTransfer(
  payerSigner,
  payerAddress,
  payerTokenAccount,
  treasuryTokenAccount,
  treasuryWallet,
  usdcMint,
  amount,
  rpcUrl
);
// Transaction is now settled on-chain
```

**Step 3: Client Sends Signature**
```typescript
// Client sends transaction signature to server
const response = await fetch('/api/ads', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-PAYMENT': paymentTx // Transaction signature
  },
  body: JSON.stringify({
    title: 'Test Ad',
    description: 'Test description',
    days: 7
  })
});
```

#### 4.2 No Stale Blockhash Issues

**Why No Stale Blockhash:**
- Transaction is settled BEFORE reaching backend
- Backend only verifies already-confirmed transaction
- No blockhash expiration risk
- No transaction rebuilding needed

---

### 5. Updated Flow Diagram

```
┌─────────┐
│ Client  │
└────┬────┘
     │ 1. POST /api/ads { title, description, days }
     ▼
┌─────────┐
│ Server  │
└────┬────┘
     │ 2. 402 Payment Required + payment details
     ▼
┌─────────┐
│ Client  │
└────┬────┘
     │ 3. Create payment transaction
     │ 4. SETTLE transaction (send to blockchain)
     │ 5. Get transaction signature
     │ 6. POST /api/ads + X-PAYMENT header (signature)
     ▼
┌─────────┐
│ Server  │
└────┬────┘
     │ 7. Extract payer from signature
     │ 8. VERIFY transaction FIRST (fast check)
     │    ├─ Verification fails → Return error (402)
     │    └─ Verification succeeds → Continue
     │ 9. Check idempotency (check if payment_tx already exists)
     │    ├─ Duplicate → Return error (payment already used)
     │ 10. Check balance (early validation)
     │ 11. Create ad (AI, DB, Vectorize) - Can take time
     │     - AI moderation (expensive)
     │     - AI tagging (expensive)
     │     - DB insert with payment_tx (UNIQUE constraint - safety net)
     │     - Vectorize indexing (expensive)
     │     - If duplicate key error → Return existing ad (409) - should not happen normally
     │ 12. Return success with ad
     ▼
```

---

### 6. Error Handling

#### 6.1 Payment Verification Errors

**Before Payment Verification:**
- Missing `X-PAYMENT` header → `402 Payment Required`
- Invalid transaction signature format → `400 Bad Request`

**Payment Verification (FIRST - Before Ad Creation):**
- Transaction not found → `402 Payment Required` (return error immediately)
- Transaction failed on-chain → `402 Payment Required` (return error immediately)
- Payment amount mismatch → `402 Payment Required` (return error immediately)
- Payment recipient mismatch → `402 Payment Required` (return error immediately)
- Transaction not confirmed → `402 Payment Required` (return error immediately)

**After Payment Verification (Before Expensive Operations):**
- Transaction already processed (idempotency check) → `409 Conflict` or `400 Bad Request` (payment already used - like a ticket)
- Insufficient balance → `402 Payment Required` (early validation)

**During Ad Creation:**
- AI processing fails → `500 Internal Server Error` (no cleanup needed)
- Database insert fails → `500 Internal Server Error` (no cleanup needed)
  - If duplicate key error (UNIQUE constraint) → `409 Conflict` (return existing ad) - should not happen normally (safety net)
- Vectorize indexing fails → Continue (non-blocking)

**Key Points:**
- Payment verification happens FIRST. If verification fails, return error immediately (no expensive operations wasted).
- Idempotency check happens AFTER verification and BEFORE expensive operations (AI, Vectorize) to prevent wasting resources.
- UNIQUE constraint is a safety net that should not trigger in normal flow (race condition protection).

#### 6.2 Idempotency Handling

**Duplicate Transaction (After Verification):**
- Check if transaction signature already exists in database
- If duplicate → Return error (payment already used - like a ticket)
- This prevents reusing the same payment transaction multiple times
- Payment transaction is like a ticket - can only be used once

**Implementation:**
```typescript
// After payment verification - before expensive operations
const existing = await env.DB.prepare(
  'SELECT ad_id FROM Ads WHERE payment_tx = ?'
).bind(paymentSignature).first<{ ad_id: string } | undefined>();

if (existing) {
  // Payment already used - return error (like a ticket)
  return {
    success: false,
    error: 'Payment already used',
    message: 'This payment transaction has already been used to create an ad'
  };
}
```

#### 6.3 Rollback Mechanism

**No Rollback Needed:**
- Payment verification happens BEFORE ad creation
- If verification fails, return error immediately (no ad created)
- If ad creation fails, return error (no cleanup needed)
- UNIQUE constraint on `payment_tx` prevents duplicate inserts

**Exception:** If we add async operations after DB insert, we might need rollback, but current flow doesn't require it.

---

### 7. Backward Compatibility

#### 7.1 Migration Strategy

**Option 1: Support Both (During Transition)**
- Check if request has `X-PAYMENT` header → Use new flow
- Check if request has `payment_tx` field → Use old flow (deprecated)
- Log deprecation warning for old flow

**Option 2: Breaking Change**
- Remove `payment_tx` support immediately
- Update all clients to use new flow
- Update documentation

**Recommendation:** Option 1 for hackathon, Option 2 for production

---

### 8. Test Updates

#### 8.1 Update Payment Tests

**File:** `packages/backend/src/test/payment.test.ts`

**Changes:**
- Test `402 Payment Required` response
- Test transaction signature verification (already on-chain)
- Test idempotency (duplicate transaction handling)
- Test rollback on verification failure

**New Test Cases:**
```typescript
describe('x402 Payment Flow', () => {
  it('should return 402 Payment Required on first request', async () => {
    // Request without payment
    // Expect 402 with payment details
  });

  it('should verify already-settled transaction', async () => {
    // Client settles transaction first
    // Client sends signature
    // Server verifies transaction
  });

  it('should prevent duplicate ad creation (idempotency)', async () => {
    // Create ad with transaction signature
    // Try to create another ad with same signature
    // Expect 409 Conflict with existing ad
  });

  it('should rollback ad if verification fails', async () => {
    // Create ad with invalid transaction signature
    // Verify ad is rolled back
  });
});
```

---

### 9. Implementation Steps

#### Phase 1: Payment Details & Types
- [ ] Create `PaymentDetails` type
- [ ] Update shared types package
- [ ] Add facilitator URL to payment details

#### Phase 2: API Endpoint Updates
- [ ] Modify POST `/api/ads` to return `402 Payment Required`
- [ ] Add `X-PAYMENT` header parsing
- [ ] Support both `X-PAYMENT` header and `payment_tx` field (backward compatibility)

#### Phase 3: Idempotency Protection
- [ ] Create `services/idempotency.ts`
- [ ] Implement `checkTransactionAlreadyProcessed()`
- [ ] Add idempotency check to `createAdWithPayment()` (after verification, before expensive ops)
- [ ] Return error if duplicate found (payment already used - like a ticket)

#### Phase 4: Verification Flow Updates
- [ ] Update `createAdWithPayment()` flow
- [ ] **Move payment verification FIRST (before any expensive operations)**
- [ ] **Add idempotency check AFTER verification and BEFORE expensive operations**
- [ ] Keep balance check AFTER verification (early validation)
- [ ] Remove rollback (not needed - verification happens first)
- [ ] Add UNIQUE constraint on payment_tx column (safety net - should not happen normally)

#### Phase 5: Error Handling
- [ ] Update error responses for payment verification (happens FIRST)
- [ ] Remove rollback logic (not needed - verification happens first)
- [ ] Add idempotency error handling (409 Conflict)
- [ ] Add proper error messages

#### Phase 6: Testing
- [ ] Update existing payment tests
- [ ] Add idempotency tests
- [ ] Add rollback tests
- [ ] Test full flow end-to-end

#### Phase 7: Documentation
- [ ] Update API documentation
- [ ] Update MCP documentation
- [ ] Add x402 payment flow guide
- [ ] Update client examples

---

### 10. Key Implementation Details

#### 10.1 Payment Signature Format

**Transaction Signature:**
- Base58 encoded Solana transaction signature
- Already confirmed on-chain
- Can be verified via `getTransaction` RPC call

**Example:**
```typescript
// Client settles transaction and gets signature
const paymentTx = await createAndSendTokenTransfer(...);
// paymentTx is a base58 string like:
// "5VERv8NMvzbJMEKV8ghdqxEdNd5d3okZcs5c1a16S45z9W4WSKxE2TG8Zn2vZv2XZ26poizCHY5vdYMBKCYeg4KG"

// Client sends signature in X-PAYMENT header
headers: {
  'X-PAYMENT': paymentTx
}
```

#### 10.2 Idempotency Implementation

**Database Schema Addition:**
```sql
-- Ads table already has payment_tx column
-- Add unique index to prevent duplicate transactions
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tx ON Ads(payment_tx);
```

**Note:** If unique constraint already exists, database will handle duplicate prevention automatically.

**Idempotency Check:**
```typescript
// Before creating ad
const existing = await env.DB.prepare(
  'SELECT ad_id FROM Ads WHERE payment_tx = ?'
).bind(paymentSignature).first<{ ad_id: string } | undefined>();

if (existing) {
  // Transaction already processed
  const existingAd = await dbService.getAd(env.DB, existing.ad_id);
  return {
    success: true,
    ad: existingAd,
    duplicate: true
  };
}
```

#### 10.3 Balance Check (Early Validation)

**Why Keep Balance Check:**
- Better error messages (tell user before expensive operations)
- Early rejection before AI processing
- Helpful for debugging payment issues
- Matches x402 template pattern (early validation)

**Note:** Balance check is technically redundant since transaction already succeeded, but provides better UX.

**Implementation:**
```typescript
// Before creating ad (early validation)
const payerBalance = await getPayerUSDCBalance(extractedPayer, env.USDC_MINT, env);
if (payerBalance < expectedAmount.price) {
  return {
    success: false,
    error: 'Insufficient USDC balance',
    details: `Payer has ${(payerBalance / 1_000_000).toFixed(6)} USDC, but ${expectedAmount.priceUSDC} USDC is required`
  };
}
```

---

### 11. API Endpoint Changes

#### 11.1 POST `/api/ads` - Updated Flow

**Request without payment:**
```http
POST /api/ads HTTP/1.1
Content-Type: application/json

{
  "title": "Test Ad",
  "description": "Test description",
  "days": 7
}
```

**Response:**
```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "paymentRequired": true,
  "paymentDetails": {
    "amount": "0.10",
    "currency": "USDC",
    "recipient": "treasury-token-account-address",
    "mint": "USDC_MINT_ADDRESS",
    "network": "devnet",
    "scheme": "exact",
    "facilitatorUrl": "https://x402.org/facilitator"
  }
}
```

**Request with payment:**
```http
POST /api/ads HTTP/1.1
Content-Type: application/json
X-PAYMENT: 5VERv8NMvzbJMEKV8ghdqxEdNd5d3okZcs5c1a16S45z9W4WSKxE2TG8Zn2vZv2XZ26poizCHY5vdYMBKCYeg4KG

{
  "title": "Test Ad",
  "description": "Test description",
  "days": 7
}
```

**Response:**
```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "success": true,
  "ad": {
    "ad_id": "uuid",
    "title": "Test Ad",
    ...
  }
}
```

**Duplicate Transaction Response:**
```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "success": true,
  "duplicate": true,
  "ad": {
    "ad_id": "existing-uuid",
    ...
  },
  "message": "Transaction already processed"
}
```

---

### 12. State Management (Simplified)

#### 12.1 State Flow

```
┌─────────────────────────────────────────────────────────┐
│ INITIAL                                                  │
│ - Request received without payment                      │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ PAYMENT_REQUIRED                                        │
│ - Return 402 with payment details                       │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ CLIENT_SETTLES                                          │
│ - Client creates and settles transaction                │
│ - Client gets transaction signature                     │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ PAYMENT_VERIFICATION (FIRST - Before Expensive Ops)     │
│ - Extract payer from signature                          │
│ - Verify transaction exists                            │
│ - Verify transaction succeeded                         │
│ - Verify payment amount matches                         │
│ - Verify payment recipient matches                      │
└────────────┬────────────────────────────────────────────┘
             │
             ├─ Verification fails → Return error (402)
             │                    - No ad creation (save resources)
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ IDEMPOTENCY_CHECK (Before Expensive Ops)                │
│ - Check if payment_tx already exists in DB              │
│ - Payment already used (like a ticket)                  │
└────────────┬────────────────────────────────────────────┘
             │
             ├─ Duplicate found → Return error (payment already used)
             │                 - Prevent expensive AI/Vectorize calls
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ BALANCE_CHECK                                           │
│ - Check payer balance (early validation)                │
└────────────┬────────────────────────────────────────────┘
             │
             ├─ Insufficient balance → Return error (402)
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ CREATING                                                │
│ - AI moderation (5-10s) - EXPENSIVE                     │
│ - AI tagging (5-10s) - EXPENSIVE                        │
│ - DB insert with payment_tx (UNIQUE constraint)         │
│ - Vectorize indexing (non-blocking) - EXPENSIVE         │
└────────────┬────────────────────────────────────────────┘
             │
             ├─ Duplicate key error → Return existing ad (409)
             ├─ Creation fails → Return error (500)
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ SUCCESS                                                 │
│ - Payment verified (already done)                      │
│ - Ad is active and paid                                 │
└─────────────────────────────────────────────────────────┘
```

#### 12.2 State Persistence

**Simple Approach (Recommended):**
- Use `payment_tx` column in Ads table for idempotency
- Add UNIQUE constraint on `payment_tx` column
- No separate state table needed
- Simpler implementation

**Database Schema:**
```sql
-- Ads table already has payment_tx column
-- Add unique constraint for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tx ON Ads(payment_tx);
```

**Note:** Since payment verification happens BEFORE ad creation, we don't need complex state tracking. Simple idempotency check is sufficient.

---

### 13. Idempotency & Replay Protection

#### 13.1 Idempotency Implementation

**Database Constraint:**
```sql
-- Add unique constraint to payment_tx column
-- This prevents duplicate inserts at database level
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tx ON Ads(payment_tx);
```

**Application Logic (Two-Level Protection):**

**Level 1: Idempotency Check (After Verification, Before Expensive Ops)**
```typescript
// After payment verification - before expensive operations (AI, Vectorize)
// Check if payment_tx already exists in database
const existing = await env.DB.prepare(
  'SELECT ad_id FROM Ads WHERE payment_tx = ?'
).bind(paymentSignature).first<{ ad_id: string } | undefined>();

if (existing) {
  // Payment already used - return error (like a ticket)
  return {
    success: false,
    error: 'Payment already used',
    message: 'This payment transaction has already been used to create an ad'
  };
}
```

**Level 2: Database Constraint (During Insert - Safety Net)**
```typescript
// During ad creation - DB insert
try {
  await dbService.createAd(env.DB, ad);
} catch (error) {
  // Check if it's a duplicate key error
  if (error.message?.includes('UNIQUE constraint') || error.message?.includes('duplicate')) {
    // Race condition: Another request inserted same payment_tx
    // Query for existing ad
    const existing = await env.DB.prepare(
      'SELECT ad_id FROM Ads WHERE payment_tx = ?'
    ).bind(paymentSignature).first<{ ad_id: string }>();
    
    if (existing) {
      const existingAd = await dbService.getAd(env.DB, existing.ad_id);
      return {
        success: true,
        ad: existingAd,
        duplicate: true,
        message: 'Transaction already processed'
      };
    }
  }
  // Other errors - rethrow
  throw error;
}
```

#### 13.2 Replay Protection

**Same as Idempotency:**
- Unique constraint on `payment_tx` prevents replay
- Same transaction signature cannot create multiple ads
- Database enforces uniqueness at database level

---

### 14. MCP Tool Updates

#### 14.1 Update `postAd` Tool

**Current:** Accepts `payment_tx` (transaction signature)

**New:** 
- Tool description should mention x402 payment flow
- Client should:
  1. First call without payment → Get 402 response
  2. Settle payment transaction (via facilitator or directly)
  3. Get transaction signature
  4. Call again with `payment_tx` field or `X-PAYMENT` header

**Tool Description Update:**
```typescript
'Post a new advertisement to Three.ad. Creates an ad that will be displayed to users matching the criteria. Requires payment_tx (x402 payment transaction signature) - the payment transaction must be settled on-chain BEFORE calling this tool. The author (payer) will be extracted from the payment transaction.'
```

**Note:** For MCP, we can keep `payment_tx` in request body for simplicity, or support both `payment_tx` and `X-PAYMENT` header.

---

### 15. Migration Checklist

- [ ] Add `402 Payment Required` response to POST `/api/ads`
- [ ] Add `X-PAYMENT` header parsing
- [ ] Add idempotency check (duplicate transaction prevention)
- [ ] Add `checkTransactionAlreadyProcessed()` function
- [ ] Update `createAdWithPayment()` flow
- [ ] Keep balance check (early validation)
- [ ] Keep verification (transaction already on-chain)
- [ ] Update error handling for idempotency (409 Conflict)
- [ ] Update rollback mechanism
- [ ] Update tests
- [ ] Update documentation
- [ ] Test full flow end-to-end
- [ ] Deploy to devnet
- [ ] Update client examples

---

### 16. Files to Modify

1. **New Files:**
   - `packages/shared/src/types/payment.ts` (add PaymentDetails type)
   - `packages/backend/src/services/idempotency.ts` (new idempotency check)

2. **Modified Files:**
   - `packages/backend/src/routes/ads.ts` (add 402 response, X-PAYMENT parsing)
   - `packages/backend/src/services/createAdWithPayment.ts` (add idempotency check)
   - `packages/backend/src/services/db.ts` (add unique index on payment_tx)
   - `packages/backend/src/test/payment.test.ts` (update tests)
   - `packages/backend/src/mcp/server.ts` (update tool description)
   - `docs/MCP.md` (update payment flow documentation)

---

### 17. Testing Strategy

1. **Unit Tests:**
   - Payment details generation
   - Transaction signature verification
   - Idempotency checks
   - Balance checking
   - Error handling

2. **Integration Tests:**
   - Full x402 flow (402 → payment → verification → ad creation)
   - Idempotency (duplicate transaction handling)
   - Verification failure → rollback
   - Balance check → early rejection

3. **Manual Testing:**
   - Test with real Solana transactions
   - Test idempotency (same transaction twice)
   - Test verification failure scenarios

---

### 18. Timeline Estimate

- **Phase 1:** 1 hour (payment details types)
- **Phase 2:** 1-2 hours (API endpoint updates)
- **Phase 3:** 1-2 hours (idempotency implementation)
- **Phase 4:** 1 hour (verification flow updates)
- **Phase 5:** 1 hour (error handling)
- **Phase 6:** 2-3 hours (testing)
- **Phase 7:** 1 hour (documentation)

**Total:** ~8-11 hours (much simpler than previous plan!)

---

### 19. Important Notes

1. **Client Settles Transaction** - Client MUST settle transaction BEFORE sending signature to backend. Backend only verifies.

2. **No Server-Side Settlement** - Backend does NOT send transactions to blockchain. Transaction is already settled.

3. **No Stale Blockhash Issues** - Transaction is already settled, so no blockhash expiration concerns.

4. **VERIFY FIRST** - Payment verification happens BEFORE ad creation. Fail fast if payment is invalid.

5. **Idempotency is CRITICAL** - Same transaction signature must not create multiple ads. Use TWO levels:
   - Level 1: Idempotency check AFTER verification, BEFORE expensive ops (payment already used - like a ticket)
   - Level 2: UNIQUE constraint on `payment_tx` (database-level safety net - should not happen normally)

6. **UNIQUE Constraint on payment_tx** - Database-level safety net for race conditions. Should not trigger in normal flow.

7. **Check Duplicate After Verification** - MUST check for duplicate payment_tx AFTER verification and BEFORE AI/Vectorize calls to prevent wasting resources. If duplicate found, return error (payment already used).

8. **No Rollback Needed** - Payment verification happens before ad creation. If verification fails, no ad is created (no cleanup needed).

9. **Balance Check After Verification** - Technically redundant (transaction already succeeded), but useful for early validation and better error messages.

10. **Replay Protection** - Same as idempotency - unique constraint prevents replay attacks.

---

### 20. Comparison: Previous Plan vs Current Plan

| Aspect | Previous Plan (Server Settles) | Current Plan (Client Settles) |
|--------|-------------------------------|------------------------------|
| **Settlement** | Server settles transaction | Client settles transaction |
| **Stale Blockhash** | Major concern, needs handling | Not an issue (already settled) |
| **Complexity** | High (settlement, blockhash refresh) | Low (verification only) |
| **Transaction Format** | Payment payload needed | Just transaction signature |
| **Blockhash Management** | Server must refresh | Client handles |
| **Durable Nonces** | Considered for long processing | Not needed (already settled) |
| **State Management** | Complex (settlement state) | Simple (verification state) |
| **Timeline** | 12-18 hours | 8-11 hours |

---

## Summary

This plan outlines the correct x402 implementation based on the template:

1. ✅ Client requests resource → Server returns `402 Payment Required`
2. ✅ Client settles transaction (via facilitator or directly)
3. ✅ Client sends transaction signature to server
4. ✅ **Server VERIFIES transaction FIRST** (before expensive operations)
5. ✅ Server checks idempotency AFTER verification (before expensive ops - payment already used check)
6. ✅ Server processes ad creation (only if verification and idempotency check succeed)
7. ✅ UNIQUE constraint on payment_tx prevents duplicates at database level (safety net - should not happen normally)

**Key Flow Improvements:**
- ✅ **VERIFY FIRST** - Payment verification before expensive operations (fail fast)
- ✅ **Idempotency check AFTER verification, BEFORE expensive ops** - Prevents wasting resources on AI/Vectorize
- ✅ **Payment already used error** - If duplicate found, return error (like a ticket)
- ✅ **No rollback needed** - Verification happens before ad creation
- ✅ **UNIQUE constraint** - Database-level safety net (should not happen normally)
- ✅ **Two-level idempotency** - Application check + database constraint
- ✅ No server-side settlement needed
- ✅ No stale blockhash handling needed
- ✅ No transaction rebuilding needed
- ✅ Simple verification-only approach

**This matches the x402 template pattern exactly!**
