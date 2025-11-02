/**
 * Test utilities for creating Solana payment transactions
 * For testing x402 payment verification
 * 
 * NOTE: These are test-specific utilities that use a faucet keypair.
 * General transaction creation utilities are in src/utils/transactions.ts
 */

import {
  generateKeyPairSigner,
  createKeyPairSignerFromBytes,
  address as parseAddress,
} from '@solana/kit';
import { readFileSync } from 'fs';
import { join } from 'path';
import bs58 from 'bs58';
import { USDC_MINT_DEVNET } from '../../utils/constants';
import { getAssociatedTokenAddress } from '../../utils/ata';
import { createAndSendTokenTransfer, createAndSendSolTransfer } from '../../utils/transactions';

export interface TestPayerKeypair {
  publicKeyBase58: string;
  signer: Awaited<ReturnType<typeof generateKeyPairSigner>>;
  fundFromFaucet: (usdcAmount: number, solLamports?: number) => Promise<{ solTx: string; usdcTx: string }>; // Returns transaction signatures
  createPaymentTransaction: (amount: number, recipientTokenAccount: string) => Promise<string>; // Returns transaction signature
}

/**
 * Load faucet keypair from file (standard Solana keypair format: JSON array of 64 bytes)
 * Format: [32-byte private key, 32-byte public key]
 */
export function loadFaucetKeypair(): Uint8Array {
  try {
    const faucetPath = join(process.cwd(), 'faucet.keypair.json');
    // Standard Solana keypair format: JSON array of 64 numbers
    const keypairBytes = JSON.parse(readFileSync(faucetPath, 'utf-8')) as number[];
    if (!Array.isArray(keypairBytes) || keypairBytes.length !== 64) {
      throw new Error('Invalid keypair format: expected array of 64 bytes');
    }
    return new Uint8Array(keypairBytes);
  } catch (error) {
    throw new Error(
      `Failed to load faucet keypair from faucet.keypair.json. ` +
      `Generate it with: solana-keygen new --outfile faucet.keypair.json --no-bip39-passphrase\n` +
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}


/**
 * Generate a test payer keypair that can be funded from the faucet
 * and can create payment transactions
 */
export async function generatePayerKeypair(): Promise<TestPayerKeypair> {
  // Generate keypair using @solana/kit
  const signer = await generateKeyPairSigner();
  const publicKeyBase58 = signer.address;

  // Function to fund this keypair with both SOL and USDC from the faucet
  const fundFromFaucet = async (
    usdcAmount: number,
    solLamports: number = 1_000_000_000 // Default: 1 SOL
  ): Promise<{ solTx: string; usdcTx: string }> => {
    // Load faucet keypair from JSON file (standard Solana format: 64-byte array)
    const faucetSecretKey = loadFaucetKeypair();
    
    // Extract public key (last 32 bytes) and create signer
    const faucetPublicKeyBytes = faucetSecretKey.slice(32, 64);
    const faucetPublicKeyBase58 = bs58.encode(faucetPublicKeyBytes);
    console.log('Faucet Public Key:', faucetPublicKeyBase58);
    const faucetSigner = await createKeyPairSignerFromBytes(faucetSecretKey);
    console.log('Faucet Signer Address:', faucetSigner.address);
    console.log('Addresses match:', faucetPublicKeyBase58 === faucetSigner.address);
    
    const usdcMint = process.env.USDC_MINT || USDC_MINT_DEVNET;
    // Always use official Solana devnet RPC
    const rpcUrl = 'https://api.devnet.solana.com';
    
    // Transfer SOL from faucet to payer
    const solTx = await createAndSendSolTransfer(
      faucetSigner,
      faucetPublicKeyBase58,
      publicKeyBase58,
      solLamports,
      rpcUrl
    );
    
    // Derive both token accounts for USDC transfer
    const faucetTokenAccount = getAssociatedTokenAddress(usdcMint, faucetPublicKeyBase58);
    const payerTokenAccount = getAssociatedTokenAddress(usdcMint, publicKeyBase58);
    
    // Transfer USDC from faucet to payer
    // Note: recipientOwner is the payer's wallet (owner of the ATA), usdcMint is needed for ATA creation
    const usdcTx = await createAndSendTokenTransfer(
      faucetSigner,
      faucetPublicKeyBase58,
      faucetTokenAccount,
      payerTokenAccount,
      publicKeyBase58, // recipientOwner - payer's wallet that owns the ATA
      usdcMint,
      usdcAmount,
      rpcUrl
    );
    
    return { solTx, usdcTx };
  };

  // Function to create a payment transaction to the treasury
  const createPaymentTransaction = async (
    amount: number, // Amount in smallest units (e.g., 100_000 for 0.1 USDC)
    recipientTokenAccount: string
  ): Promise<string> => {
    const usdcMint = process.env.USDC_MINT || USDC_MINT_DEVNET;
    // Always use official Solana devnet RPC
    const rpcUrl = 'https://api.devnet.solana.com';
    
    // Derive payer's USDC token account (ATA)
    const payerTokenAccount = getAssociatedTokenAddress(usdcMint, publicKeyBase58);
    
    // Extract recipient owner from environment (treasury wallet)
    const recipientWallet = process.env.RECIPIENT_WALLET || 'Hf1BvFzfGiAzPoV6oHWSxQuNEiGxyULuZh8zU4ZMknFM';
    
    // Use general transaction utility
    return createAndSendTokenTransfer(
      signer,
      publicKeyBase58,
      payerTokenAccount,
      recipientTokenAccount,
      recipientWallet, // recipientOwner - treasury wallet that owns the ATA
      usdcMint,
      amount,
      rpcUrl
    );
  };

  return {
    publicKeyBase58,
    signer,
    fundFromFaucet,
    createPaymentTransaction,
  };
}
