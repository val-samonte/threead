/**
 * Test utility for generating Solana-compatible keypairs and signing messages
 * Uses @solana/kit for proper Solana compatibility
 * 
 * Note: In production, clients use @solana/kit or wallet adapters
 * This is ONLY for testing server-side signature verification
 */

import { generateKeyPairSigner, createSignableMessage } from '@solana/kit';
import bs58 from 'bs58';

export interface TestKeypair {
  publicKey: string; // Base58 encoded public key (address)
  signMessage: (message: string) => Promise<string>; // Returns base58 encoded signature
}

/**
 * Generate a test Solana keypair using @solana/kit
 * Fully compatible with Solana signature verification
 */
export async function generateKeypair(): Promise<TestKeypair> {
  // Generate Solana keypair signer using @solana/kit
  const signer = await generateKeyPairSigner();

  // Get public key as base58 string (address)
  const publicKeyBase58 = signer.address;

  // Sign message function
  const signMessage = async (message: string): Promise<string> => {
    const messageBytes = new TextEncoder().encode(message);
    
    // Create signable message and sign it
    const signableMessage = createSignableMessage(messageBytes);
    const signedMessage = await signer.signMessages([signableMessage]);
    
    // Extract signature bytes from signed message
    // signedMessage[0] is an object: { [address]: Uint8Array }
    const signatureBytes = Object.values(signedMessage[0])[0] as Uint8Array;
    
    // Encode signature bytes to base58 string
    return bs58.encode(signatureBytes);
  };

  return {
    publicKey: publicKeyBase58,
    signMessage,
  };
}

