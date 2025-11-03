/**
 * Solana transaction verification service
 * Verifies x402 payments without a facilitator
 */

import type { Env } from '../types/env';
import { smallestUnitsToUSDC } from '@threead/shared';
import { createSolanaRpc } from '@solana/rpc';
import { address as parseAddress } from '@solana/kit';
import { getAssociatedTokenAddress } from '../utils/ata';

/**
 * Token balance change from transaction metadata
 */
interface TokenBalanceChange {
  accountIndex: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}

/**
 * Transaction response type from Solana RPC
 */
type TransactionResponse = {
  error?: { message?: string }; 
  result?: {
    transaction?: {
      message?: {
        accountKeys?: Array<{ pubkey?: string } | string>;
      };
    };
    meta?: {
      err?: unknown;
      fee?: number;
      postTokenBalances?: TokenBalanceChange[];
      preTokenBalances?: TokenBalanceChange[];
    };
    slot?: number;
  };
} | null;

/**
 * Extract account key from transaction accountKeys array
 * Handles both formats: string or object with pubkey property
 */
function extractAccountKey(accountKey: string | { pubkey?: string } | undefined): string | undefined {
  if (typeof accountKey === 'string') {
    return accountKey;
  }
  if (accountKey && typeof accountKey === 'object' && 'pubkey' in accountKey) {
    return accountKey.pubkey;
  }
  return undefined;
}

/**
 * Get USDC balance from a payer's Associated Token Account (ATA)
 * @param payerAddress - Payer's wallet address (base58)
 * @param usdcMint - USDC mint address
 * @param env - Environment with RPC URL
 * @returns Balance in smallest units (e.g., 1000000 = 1 USDC)
 */
export async function getPayerUSDCBalance(
  payerAddress: string,
  usdcMint: string,
  env: Env
): Promise<number> {
  try {
    const rpc = createSolanaRpc(env.SOLANA_RPC_URL);
    
    // Derive payer's ATA
    const payerATA = await getAssociatedTokenAddress(usdcMint, payerAddress);
    
    // Get token account info
    const accountInfo = await rpc.getAccountInfo(parseAddress(payerATA), {
      commitment: 'confirmed',
      encoding: 'jsonParsed',
    }).send();
    
    if (!accountInfo.value) {
      // ATA doesn't exist = 0 balance
      return 0;
    }
    
    // Parse token account data
    const parsed = accountInfo.value.data;
    if (typeof parsed === 'object' && parsed !== null && 'parsed' in parsed) {
      const parsedData = parsed.parsed as { info?: { tokenAmount?: { amount?: string } } };
      if (parsedData?.info?.tokenAmount?.amount) {
        return Number(parsedData.info.tokenAmount.amount);
      }
    }
    
    // Fallback: try to decode raw data if parsed format is not available
    // Token account structure: mint (32 bytes) + owner (32 bytes) + amount (8 bytes) + ...
    if (typeof parsed === 'object' && parsed !== null && 'data' in parsed) {
      const rawData = parsed.data as string[];
      if (Array.isArray(rawData) && rawData.length > 0) {
        // For base64 encoded data, we'd need to decode it
        // But jsonParsed should always give us the parsed format
        return 0;
      }
    }
    
    return 0;
  } catch (error) {
    console.error('[getPayerUSDCBalance] Error getting balance:', error);
    // Return 0 on error to be safe (will fail balance check)
    return 0;
  }
}

/**
 * Fetch transaction from Solana RPC with retry logic
 * Transactions may not be immediately queryable after confirmation (RPC indexing delay)
 */
async function fetchTransaction(
  signature: string,
  env: Env,
  options: { retries?: number; retryDelayMs?: number } = {}
): Promise<TransactionResponse> {
  const maxRetries = options.retries ?? 3;
  const baseDelayMs = options.retryDelayMs ?? 1000;
  
  for (let retry = 0; retry < maxRetries; retry++) {
    // Add delay on retries (exponential backoff)
    if (retry > 0) {
      const delayMs = Math.min(baseDelayMs * Math.pow(2, retry - 1), 5000); // Max 5s
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    const response = await fetch(`${env.SOLANA_RPC_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [
          signature,
          {
            encoding: 'jsonParsed',
            maxSupportedTransactionVersion: 1,
            commitment: 'confirmed',
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(`[fetchTransaction] HTTP error ${response.status}, retry ${retry}`);
      continue;
    }

    let data: TransactionResponse = null;
    try {
      const responseText = await response.text();
      try {
        data = JSON.parse(responseText) as TransactionResponse;
      } catch (parseError) {
        console.error(`[fetchTransaction] Failed to parse JSON response, retry ${retry}:`, parseError);
        console.error(`[fetchTransaction] Response text (first 500 chars):`, responseText.substring(0, 500));
        continue;
      }
    } catch (textError) {
      console.error(`[fetchTransaction] Failed to read response text, retry ${retry}:`, textError);
      continue;
    }
    
    // If we got a result, return it
    if (data && !data.error && data.result) {
      return data;
    }
    
    // If we got an error or no result, continue to next retry
    if (!data || data.error || !data.result) {
      continue;
    }
  }

  // All retries failed
  return null;
}

export interface VerificationResult {
  valid: boolean;
  amount: number; // In smallest units
  amountUSDC: number;
  signature: string;
  recipient: string;
  payer?: string; // Payer's address (extracted from transaction)
  error?: string;
}

/**
 * Extract payer address from Solana transaction signature
 * This can be used even when full payment verification is deferred
 * 
 * @param signature - Transaction signature
 * @param env - Environment with SOLANA_RPC_URL
 * @returns Payer's address (base58 string) or null if extraction fails
 */
export async function extractPayerFromTransaction(
  signature: string,
  env: Env
): Promise<string | null> {
  try {
    const transactionData = await fetchTransaction(signature, env, { retries: 1, retryDelayMs: 0 });

    // If we got a result, extract payer
    if (transactionData && !transactionData.error && transactionData.result) {
      const accountKeys = transactionData.result.transaction?.message?.accountKeys;
      if (accountKeys && accountKeys.length > 0) {
        const firstAccount = accountKeys[0];
        const payerPubkey = extractAccountKey(firstAccount);

        if (payerPubkey && typeof payerPubkey === 'string') {
          return payerPubkey;
        }
      }
    }
    
    // If no result or error
    console.error('[extractPayerFromTransaction] RPC error or no result:', {
      signature: signature.substring(0, 16) + '...',
      error: transactionData?.error,
      hasResult: !!transactionData?.result,
      resultIsNull: transactionData?.result === null,
    });
    return null;
  } catch (error) {
    console.error('Failed to extract payer from transaction:', error);
    return null;
  }
}

/**
 * Verify Solana transaction signature and payment amount
 * Verifies that the transaction contains a USDC transfer to the recipient
 */
export async function verifyPayment(
  signature: string,
  expectedAmount: number,
  recipientTokenAccount: string,
  env: Env
): Promise<VerificationResult> {
  try {
    // Extract payer first
    const payer = await extractPayerFromTransaction(signature, env);
    
    // Fetch transaction from Solana RPC with retry logic
    // Transactions may not be immediately queryable after confirmation (RPC indexing delay)
    const transactionData = await fetchTransaction(signature, env, { retries: 3, retryDelayMs: 1000 });

    if (!transactionData || transactionData.error || !transactionData.result) {
      return {
        valid: false,
        amount: 0,
        amountUSDC: 0,
        signature,
        recipient: recipientTokenAccount,
        payer: payer || undefined,
        error: transactionData?.error?.message || 'Transaction not found',
      };
    }
    
    const data = transactionData;
    
    // At this point, we know data.result exists
    if (!data.result) {
      return {
        valid: false,
        amount: 0,
        amountUSDC: 0,
        signature,
        recipient: recipientTokenAccount,
        payer: payer || undefined,
        error: 'Transaction result is null',
      };
    }

    // Check transaction was successful
    if (data.result.meta?.err) {
      return {
        valid: false,
        amount: 0,
        amountUSDC: 0,
        signature,
        recipient: recipientTokenAccount,
        payer: payer || undefined,
        error: 'Transaction failed',
      };
    }

    // Check transaction is confirmed (has slot)
    if (!data.result.slot) {
      return {
        valid: false,
        amount: 0,
        amountUSDC: 0,
        signature,
        recipient: recipientTokenAccount,
        payer: payer || undefined,
        error: 'Transaction not confirmed',
      };
    }

    // Find token balance changes for the recipient account
    const postBalances = data.result.meta?.postTokenBalances || [];
    const preBalances = data.result.meta?.preTokenBalances || [];

    // Find the recipient's token account in the transaction
    let recipientReceived = 0;
    let recipientBalanceChange: TokenBalanceChange | undefined;

    for (const postBalance of postBalances) {
      // Check if this is the recipient token account
      const accountKeys = data.result.transaction?.message?.accountKeys;
      if (!accountKeys || !accountKeys[postBalance.accountIndex]) {
        continue;
      }

      // Handle both formats: array of strings OR array of objects with pubkey
      const accountKey = accountKeys[postBalance.accountIndex];
      const tokenAccountPubkey = extractAccountKey(accountKey);
      
      if (tokenAccountPubkey === recipientTokenAccount) {
        recipientBalanceChange = postBalance;
        
        // Find corresponding pre-balance
        const preBalance = preBalances.find((b: TokenBalanceChange) => b.accountIndex === postBalance.accountIndex);
        
        const preAmount = preBalance?.uiTokenAmount?.amount
          ? BigInt(preBalance.uiTokenAmount.amount)
          : 0n;
        const postAmount = postBalance.uiTokenAmount?.amount
          ? BigInt(postBalance.uiTokenAmount.amount)
          : 0n;
        
        recipientReceived = Number(postAmount - preAmount);
        break;
      }
    }

    if (!recipientBalanceChange || recipientReceived <= 0) {
    return {
      valid: false,
      amount: 0,
      amountUSDC: 0,
      signature,
      recipient: recipientTokenAccount,
        payer: payer || undefined,
        error: `No token transfer found to recipient account ${recipientTokenAccount}`,
      };
    }

    // Verify amount matches expected (allow small tolerance for rounding)
    const amountDifference = Math.abs(recipientReceived - expectedAmount);
    const tolerance = 1; // Allow 1 smallest unit difference for rounding

    if (amountDifference > tolerance) {
      return {
        valid: false,
        amount: recipientReceived,
        amountUSDC: smallestUnitsToUSDC(recipientReceived),
        signature,
        recipient: recipientTokenAccount,
        payer: payer || undefined,
        error: `Payment amount mismatch: expected ${expectedAmount} smallest units, received ${recipientReceived}`,
      };
    }

    // All checks passed
    return {
      valid: true,
      amount: recipientReceived,
      amountUSDC: smallestUnitsToUSDC(recipientReceived),
      signature,
      recipient: recipientTokenAccount,
      payer: payer || undefined,
    };
  } catch (error) {
    return {
      valid: false,
      amount: 0,
      amountUSDC: 0,
      signature,
      recipient: recipientTokenAccount,
      payer: undefined,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Verify payment and extract payer in one call
 * This is a convenience function that combines extractPayerFromTransaction and verifyPayment
 * Used by both REST API and MCP handlers to avoid code duplication
 */
export async function verifyPaymentAndExtractPayer(
  signature: string,
  expectedAmountSmallestUnits: number,
  recipientTokenAccount: string,
  env: Env
): Promise<{
  valid: boolean;
  payer: string | null;
  error?: string;
}> {
  // Extract payer first
  const payer = await extractPayerFromTransaction(signature, env);
  
  if (!payer) {
    return {
      valid: false,
      payer: null,
      error: 'Failed to extract payer from payment transaction',
    };
  }

  // Verify payment
  const verification = await verifyPayment(
    signature,
    expectedAmountSmallestUnits,
    recipientTokenAccount,
    env
  );

  if (!verification.valid || !verification.payer) {
    return {
      valid: false,
      payer: null,
      error: verification.error || 'Payment verification failed',
    };
  }

  // Ensure extracted payer matches payment verification payer
  if (verification.payer !== payer) {
    return {
      valid: false,
      payer: null,
      error: 'Payer mismatch between transaction extraction and verification',
    };
  }

  return {
    valid: true,
    payer,
  };
}

