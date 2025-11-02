/**
 * Associated Token Account (ATA) derivation
 * Uses @solana/addresses for accurate PDA derivation (part of @solana/kit ecosystem)
 */

import { address } from '@solana/kit';
import { getAddressEncoder, getProgramDerivedAddress } from '@solana/addresses';
import type { Address } from '@solana/addresses';

// SPL Token Program IDs (constants)
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/**
 * Derive Associated Token Account (ATA) address for a wallet and token mint
 * Uses @solana/addresses getProgramDerivedAddress for accurate derivation
 * 
 * @param mintAddress - Token mint address (base58 string)
 * @param ownerAddress - Wallet owner address (base58 string)
 * @returns ATA address as base58 string
 */
export async function getAssociatedTokenAddress(
  mintAddress: string,
  ownerAddress: string
): Promise<string> {
  // Validate addresses are valid base58
  address(mintAddress);
  address(ownerAddress);
  
  // Get address encoder for converting addresses to seed bytes
  const addressEncoder = getAddressEncoder();
  
  // ATA seeds: [owner, token_program_id, mint]
  // This matches the SPL Token specification exactly
  const seeds = [
    addressEncoder.encode(ownerAddress as Address),
    addressEncoder.encode(TOKEN_PROGRAM_ID as Address),
    addressEncoder.encode(mintAddress as Address),
  ];
  
  // Derive PDA using Associated Token Program
  const [pda] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID as Address,
    seeds,
  });
  
  // Return the PDA address as a string
  return pda;
}

