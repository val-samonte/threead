# Testing Order & Priority

## Priority 1: Payment Verification Tests (FIRST)

**Goal**: Verify that x402 payment verification works end-to-end before testing other features.

### Prerequisites:
1. ✅ Faucet keypair generated (`npm run faucet:generate`)
2. ✅ Faucet funded with devnet USDC
3. ✅ Treasury USDC token account address configured in `.dev.vars`
4. ✅ Payment transaction creation implemented in `test/utils/payment.ts`

### Steps:
1. ✅ **Payment transaction creation** - DONE
   - Uses `@solana/kit` to build USDC token transfer transactions
   - Automatically derives token accounts (ATAs)
   - Signs and sends transactions to devnet
   - Returns transaction signatures

2. **Test with real transactions**
   - Run `npm test -- payment.test.ts`
   - Verify payment verification extracts payer correctly
   - Verify payment amount validation works
   - Verify ad creation succeeds with valid payments
   - Verify ad creation fails with invalid/insufficient payments

3. **Once payment works**, proceed to other tests

---

## Priority 2: Basic API Tests

After payment verification is confirmed working:

1. **Health check** (`health.test.ts`)
   - Quick smoke test that server is running

2. **Ad creation with payment** (`api.test.ts`)
   - Using real payment transactions from Priority 1

3. **Ad querying** (`api.test.ts`)
   - Query ads endpoint
   - Verify responses

---

## Priority 3: Feature Tests

After basic API works:

1. **Moderation tests** (`moderation.test.ts`)
   - AI moderation scoring
   - Shadow banning logic

2. **Tag generation tests** (`tags.test.ts`)
   - AI tag generation
   - Tag filtering

3. **Vectorize tests** (`vectorize.test.ts`)
   - Semantic search
   - Embeddings indexing

4. **Analytics tests** (`analytics.test.ts`)
   - Impression tracking
   - Click tracking
   - Deduplication

---

## Current Test Status

### Ready to Test:
- ✅ Health check (basic)
- ✅ Payment verification (transaction creation implemented)
- ✅ All payment-related utilities ready

### Implementation Status:
- ✅ Payment transaction creation - implemented
- ✅ Faucet funding utilities - implemented  
- ✅ ATA derivation - implemented
- ✅ Real Solana transactions - ready to test

---

## Quick Start for Payment Testing

```bash
# 1. Generate faucet keypair
npm run faucet:generate

# 2. Fund faucet with devnet USDC (manual - use Solana CLI or faucet)

# 3. Configure treasury token account in .dev.vars
# RECIPIENT_TOKEN_ACCOUNT=your_treasury_token_account_address

# 4. Start dev server
npm run dev

# 5. In another terminal, run payment tests
npm test -- payment.test.ts
```

---

## Notes

- **DO NOT test other features until payment verification works**
- Payment is the foundation - everything depends on it
- Mock signatures won't work - need real Solana transactions
- Use devnet for all testing (safer and free)

