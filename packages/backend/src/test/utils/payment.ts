/**
 * Test utilities for creating Solana payment transactions
 * For testing x402 payment verification
 * 
 * Uses payer.keypair.json directly (no funding needed)
 */

import {
  createKeyPairSignerFromBytes,
} from '@solana/kit';
import { readFileSync } from 'fs';
import { join } from 'path';
import { USDC_MINT_DEVNET } from '../../utils/constants';
import { getAssociatedTokenAddress } from '../../utils/ata';
import { createAndSendTokenTransfer } from '../../utils/transactions';

export interface TestPayerKeypair {
  publicKeyBase58: string;
  signer: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>;
  createPaymentTransaction: (amount: number, treasuryTokenAccount: string) => Promise<string>; // Returns transaction signature
}

/**
 * Load payer keypair from file (standard Solana keypair format: JSON array of 64 bytes)
 * Format: [32-byte private key, 32-byte public key]
 */
export function loadPayerKeypair(): Uint8Array {
  try {
    const payerPath = join(process.cwd(), 'payer.keypair.json');
    // Standard Solana keypair format: JSON array of 64 numbers
    const keypairBytes = JSON.parse(readFileSync(payerPath, 'utf-8')) as number[];
    if (!Array.isArray(keypairBytes) || keypairBytes.length !== 64) {
      throw new Error('Invalid keypair format: expected array of 64 bytes');
    }
    return new Uint8Array(keypairBytes);
  } catch (error) {
    throw new Error(
      `Failed to load payer keypair from payer.keypair.json. ` +
      `Generate it with: solana-keygen new --outfile payer.keypair.json --no-bip39-passphrase\n` +
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Load payer keypair from payer.keypair.json file
 * This payer is used directly for all tests (no funding needed)
 */
export async function getPayerKeypair(): Promise<TestPayerKeypair> {
  // Load payer keypair from JSON file (standard Solana format: 64-byte array)
  const payerSecretKey = loadPayerKeypair();
  const payerSigner = await createKeyPairSignerFromBytes(payerSecretKey);
  const publicKeyBase58 = payerSigner.address;

  // Function to create a payment transaction to the treasury
  const createPaymentTransaction = async (
    amount: number, // Amount in smallest units (e.g., 100_000 for 0.1 USDC)
    treasuryTokenAccount: string
  ): Promise<string> => {
    const usdcMint = process.env.USDC_MINT || USDC_MINT_DEVNET;
    // Always use official Solana devnet RPC
    const rpcUrl = 'https://api.devnet.solana.com';
    
    // Derive payer's USDC token account (ATA)
    const payerTokenAccount = await getAssociatedTokenAddress(usdcMint, publicKeyBase58);
    
    // Get treasury wallet address from environment
    const treasuryWallet = process.env.RECIPIENT_WALLET || 'Hf1BvFzfGiAzPoV6oHWSxQuNEiGxyULuZh8zU4ZMknFM';
    
    // Use general transaction utility
    return createAndSendTokenTransfer(
      payerSigner,
      publicKeyBase58,
      payerTokenAccount,
      treasuryTokenAccount,
      treasuryWallet, // treasury wallet that owns the ATA
      usdcMint,
      amount,
      rpcUrl
    );
  };

  return {
    publicKeyBase58,
    signer: payerSigner,
    createPaymentTransaction,
  };
}
