/**
 * Payment verification tests
 * PRIORITY: Test payment verification FIRST before other features
 * 
 * These tests require:
 * 1. Faucet keypair funded with devnet USDC
 * 2. Real Solana payment transactions (not mocks)
 * 3. Treasury token account address configured
 * 
 * Run: npm run dev:backend (in one terminal)
 * Then: npm test -- payment.test.ts (in another terminal)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { requireWorkerRunning, WORKER_URL } from './utils/helpers';
import { generatePayerKeypair, type TestPayerKeypair } from './utils/payment';
import { calculatePriceSmallestUnits } from '@threead/shared';
import { getAssociatedTokenAddress } from '../utils/ata';

describe('Payment Verification Tests', () => {
  let payer: TestPayerKeypair;

  beforeAll(async () => {
    await requireWorkerRunning();
    
    // Generate payer keypair and fund it with SOL and USDC from faucet
    // This is MANDATORY for all tests - all tests need a funded payer
    console.log('Setting up funded payer for all tests...');
    payer = await generatePayerKeypair();
    
    // Fund with amounts to cover all tests:
    // - 0.02 SOL for transaction fees
    // - 1 USDC for payment transactions
    const usdcAmount = 1_000_000; // 1 USDC in smallest units
    const solAmount = 20_000_000; // 0.02 SOL (20 million lamports - enough for transaction fees)
    
    console.log('Funding payer with SOL and USDC from faucet...');
    console.log('  SOL amount:', solAmount, 'lamports (0.02 SOL)');
    console.log('  USDC amount:', usdcAmount, 'smallest units (1 USDC)');
    
    const fundingResult = await payer.fundFromFaucet(usdcAmount, solAmount);
    console.log('SOL funding transaction:', fundingResult.solTx);
    console.log('USDC funding transaction:', fundingResult.usdcTx);
    
    // Wait for transactions to confirm
    console.log('Waiting for transactions to confirm...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('Payer funded and ready for all tests');
  }, 30000); // 30 second timeout for beforeAll

  describe('Payment Transaction Creation', () => {
    it('should create a real USDC payment transaction to treasury', async () => {
      // Payer is already funded in beforeAll
      // Calculate payment amount for 1 day ad
      const amountSmallestUnits = calculatePriceSmallestUnits(1, false);
      
      // Derive treasury ATA from wallet address (from env or test constants)
      const recipientWallet = process.env.RECIPIENT_WALLET || 'Hf1BvFzfGiAzPoV6oHWSxQuNEiGxyULuZh8zU4ZMknFM';
      const usdcMint = process.env.USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
      const recipientTokenAccount = getAssociatedTokenAddress(usdcMint, recipientWallet);
      
      // Create actual payment transaction
      const paymentTx = await payer.createPaymentTransaction(
        amountSmallestUnits,
        recipientTokenAccount
      );
      
      expect(paymentTx).toBeDefined();
      expect(typeof paymentTx).toBe('string');
      expect(paymentTx.length).toBeGreaterThan(0);
      
      console.log('Payment transaction signature:', paymentTx);
      console.log('Payer address:', payer.publicKeyBase58);
    });
  });

  describe('Ad Creation with Real Payment', () => {
    it('should create ad with valid payment transaction', async () => {
      // Payer is already funded in beforeAll
      const amountSmallestUnits = calculatePriceSmallestUnits(1, false);
      
      // Derive treasury ATA from wallet address
      const recipientWallet = process.env.RECIPIENT_WALLET || 'Hf1BvFzfGiAzPoV6oHWSxQuNEiGxyULuZh8zU4ZMknFM';
      const usdcMint = process.env.USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
      const recipientTokenAccount = getAssociatedTokenAddress(usdcMint, recipientWallet);
      
      // Create payment transaction
      const paymentTx = await payer.createPaymentTransaction(
        amountSmallestUnits,
        recipientTokenAccount
      );
      
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
      // Payer is already funded in beforeAll
      // Create payment for less than required (insufficient amount)
      const insufficientAmount = 1000; // Too small (less than 0.1 USDC minimum)
      
      // Derive treasury ATA from wallet address
      const recipientWallet = process.env.RECIPIENT_WALLET || 'Hf1BvFzfGiAzPoV6oHWSxQuNEiGxyULuZh8zU4ZMknFM';
      const usdcMint = process.env.USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
      const recipientTokenAccount = getAssociatedTokenAddress(usdcMint, recipientWallet);
      
      // Create payment with insufficient amount (but still a valid transaction)
      const paymentTx = await payer.createPaymentTransaction(
        insufficientAmount,
        recipientTokenAccount
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
      expect(data.error).toContain('Payment');
    });
  });
});

