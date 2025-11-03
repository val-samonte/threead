/**
 * Payment verification tests
 * PRIORITY: Test payment verification FIRST before other features
 * 
 * These tests require:
 * 1. Payer keypair (payer.keypair.json) - should be pre-funded with devnet SOL and USDC
 * 2. Real Solana payment transactions (not mocks)
 * 3. Treasury token account address configured
 * 
 * Run: npm run dev:backend (in one terminal)
 * Then: npm test -- payment.test.ts (in another terminal)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { requireWorkerRunning, WORKER_URL, getTreasuryTokenAccount, getPayer } from './utils/helpers';
import type { TestPayerKeypair } from './utils/payment';
import { calculatePriceSmallestUnits } from '@threead/shared';

describe('Payment Verification Tests', () => {
  let payer: TestPayerKeypair;

  beforeAll(async () => {
    await requireWorkerRunning();
    
    // Load shared payer keypair from payer.keypair.json (reused across all test files)
    console.log('Loading payer keypair for payment tests...');
    payer = await getPayer();
    console.log('Using payer:', payer.publicKeyBase58);
  }, 30000); // 30 second timeout for beforeAll

  describe('Payment Transaction Creation', () => {
    it('should create a real USDC payment transaction to treasury', async () => {
      // Payer is loaded from payer.keypair.json in beforeAll
      // Calculate payment amount for 1 day ad
      const amountSmallestUnits = calculatePriceSmallestUnits(1, false);
      
      // Derive treasury ATA from wallet address (from env or test constants)
      const treasuryTokenAccount = await getTreasuryTokenAccount();
      
      // Create actual payment transaction
      // Note: This test requires the payer to be funded with SOL (for fees) and USDC (for payment)
      // Fund with: solana airdrop 1 <payer-address> (devnet)
      let paymentTx: string;
      try {
        paymentTx = await payer.createPaymentTransaction(
          amountSmallestUnits,
          treasuryTokenAccount
        );
      } catch (error: any) {
        if (error.message?.includes('Insufficient SOL') || error.message?.includes('4615026')) {
          throw new Error(
            `Payer ${payer.publicKeyBase58} needs to be funded:\n` +
            `1. SOL for fees: solana airdrop 1 ${payer.publicKeyBase58} (devnet)\n` +
            `2. USDC for payment: Use a faucet or transfer devnet USDC\n` +
            `Original error: ${error.message}`
          );
        }
        throw error;
      }
      
      expect(paymentTx).toBeDefined();
      expect(typeof paymentTx).toBe('string');
      expect(paymentTx.length).toBeGreaterThan(0);
      
      console.log('Payment transaction signature:', paymentTx);
      console.log('Payer address:', payer.publicKeyBase58);
    });
  });

  describe('Ad Creation with Real Payment', () => {
    it('should create ad with valid payment transaction', async () => {
      // Payer is loaded from payer.keypair.json in beforeAll
      const amountSmallestUnits = calculatePriceSmallestUnits(1, false);
      
      // Derive treasury ATA from wallet address
      const treasuryTokenAccount = await getTreasuryTokenAccount();
      
      // Create payment transaction
      // Note: This test requires the payer to be funded with SOL (for fees) and USDC (for payment)
      let paymentTx: string;
      try {
        paymentTx = await payer.createPaymentTransaction(
          amountSmallestUnits,
          treasuryTokenAccount
        );
      } catch (error: any) {
        if (error.message?.includes('Insufficient SOL') || error.message?.includes('4615026')) {
          throw new Error(
            `Payer ${payer.publicKeyBase58} needs to be funded:\n` +
            `1. SOL for fees: solana airdrop 1 ${payer.publicKeyBase58} (devnet)\n` +
            `2. USDC for payment: Use a faucet or transfer devnet USDC\n` +
            `Original error: ${error.message}`
          );
        }
        throw error;
      }
      
      // Wait for transaction to be indexed by RPC before verification
      // RPC indexing can take a few seconds after confirmation
      console.log('Waiting for transaction to be indexed by RPC...');
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay
      
      // Create ad with real payment transaction
      const response = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_tx: paymentTx,
          title: 'Test Ad with Real Payment',
          description: 'This ad was created with a real Solana payment transaction',
          days: 1,
        }),
      });
      
      const data = await response.json() as {
        success?: boolean;
        ad?: {
          ad_id?: string;
          author?: string;
          payment_tx?: string;
        };
        error?: string;
        details?: string;
        errors?: string[];
      };
      
      if (response.status !== 201) {
        console.error('API Error Response:', JSON.stringify(data, null, 2));
        console.error('Response Status:', response.status);
        console.error('Payment Transaction Signature:', paymentTx);
      }
      
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.ad).toBeDefined();
      expect(data.ad?.author).toBe(payer.publicKeyBase58);
      expect(data.ad?.payment_tx).toBe(paymentTx);
    });
    
    it('should reject ad with invalid payment transaction', async () => {
      // Try with a fake transaction signature
      const fakeTx = 'fake' + '1'.repeat(60);
      
      const response = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_tx: fakeTx,
          title: 'Test Ad with Invalid Payment',
          days: 1,
        }),
      });
      
      expect(response.status).toBe(400);
      const data = await response.json() as { error?: string };
      expect(data.error).toBeDefined();
    });
    
    it('should reject ad with insufficient payment amount', async () => {
      // Payer is loaded from payer.keypair.json in beforeAll
      // Create payment for less than required (insufficient amount)
      const insufficientAmount = 1000; // Too small (less than 0.1 USDC minimum)
      
      // Derive treasury ATA from wallet address
      const treasuryTokenAccount = await getTreasuryTokenAccount();
      
      // Create payment with insufficient amount (but still a valid transaction)
      const paymentTx = await payer.createPaymentTransaction(
        insufficientAmount,
        treasuryTokenAccount
      );
      
      const response = await fetch(`${WORKER_URL}/api/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_tx: paymentTx,
          title: 'Test Ad with Insufficient Payment',
          days: 1,
        }),
      });
      
      const data = await response.json() as { error?: string; details?: string };
      
      if (response.status !== 402) {
        console.error('API Error Response:', JSON.stringify(data, null, 2));
        console.error('Response Status:', response.status);
        console.error('Payment Transaction Signature:', paymentTx);
      }
      
      expect(response.status).toBe(402); // Payment Required
      expect(data.error).toBeDefined();
      // Error should mention payment or insufficient balance
      expect(data.error).toMatch(/payment|insufficient|balance/i);
    });
  });
});

