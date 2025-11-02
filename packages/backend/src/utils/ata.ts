/**
 * Associated Token Account (ATA) derivation
 * Uses @solana/spl-token for accuracy (it's already a dev dependency)
 */

import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { address } from '@solana/kit';

// SPL Token Program IDs (constants)
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/**
 * Derive Associated Token Account (ATA) address for a wallet and token mint
 * This implements the PDA derivation algorithm manually
 * 
 * @param mintAddress - Token mint address (base58 string)
 * @param ownerAddress - Wallet owner address (base58 string)
 * @returns ATA address as base58 string
 */
export function getAssociatedTokenAddress(
  mintAddress: string,
  ownerAddress: string
): string {
  // Validate addresses are valid base58
  address(mintAddress);
  address(ownerAddress);
  
  // Use @solana/spl-token's official implementation for accuracy
  // This ensures we get the exact same ATA as the Solana ecosystem expects
  const mint = new PublicKey(mintAddress);
  const owner = new PublicKey(ownerAddress);
  const ata = getAssociatedTokenAddressSync(mint, owner);
  
  return ata.toBase58();
}

