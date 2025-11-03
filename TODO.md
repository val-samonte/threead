# TODO

## Payment & Ad Creation Flow

### Rollback Mechanism
**Status**: ✅ Implemented

**Solution**: Service-first approach (create ad first, then verify payment)

**Current Flow**:
1. Client sends payment transaction (x402) - payment is already on-chain
2. API extracts payer address from transaction
3. API creates ad (tags, moderation, database insert, Vectorize indexing)
4. API verifies payment (amount, recipient, payer match)
5. If payment verification fails → **Rollback**: Delete ad from DB and Vectorize

**Benefits**:
- Avoids blockchain fees for refunds
- Database rollback is free (no transaction fees)
- Payment transaction exists but is not consumed if ad creation fails
- Payment is only considered "consumed" after successful ad creation and verification

**Rollback Implementation**:
- If payment verification fails → `deleteAd()` from database
- If payment verification fails → `deleteAdIndex()` from Vectorize
- Both operations are wrapped in `.catch()` to ensure rollback doesn't fail the error response

## Media Upload

### R2 Image Upload
**Status**: Deferred Until After Hackathon

**Decision**: R2 image upload implementation is deferred until after the hackathon submission.

**Current Behavior**: 
- Currently returns error if `media` is provided in ad creation
- Frontend will use `og:image` scraping from `link_url` as fallback for images
- Images can be added post-hackathon when R2 upload is implemented

**Post-Hackathon Implementation Plan**:
- Add media support for ads
- Create R2 upload service
- Add media serving endpoint


