/**
 * Solana transaction verification service
 * Verifies x402 payments without a facilitator
 */

import type { Env } from '../types/env';
import { smallestUnitsToUSDC } from '@threead/shared';

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
    // Try with versioned transaction support (version 1+)
    // @solana/kit creates versioned transactions, but curl test shows version 0 works
    const versionsToTry = [0, 1]; // Try legacy first, then versioned
    
    for (const maxVersion of versionsToTry) {
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
              maxSupportedTransactionVersion: maxVersion,
              commitment: 'confirmed',
            },
          ],
        }),
      });

      if (!response.ok) {
        console.error(`[extractPayerFromTransaction] HTTP error ${response.status} for version ${maxVersion}`);
        continue;
      }

      const responseText = await response.text();
      let responseData: any;
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        console.error(`[extractPayerFromTransaction] Failed to parse JSON for version ${maxVersion}:`, parseError);
        console.error(`[extractPayerFromTransaction] Response text:`, responseText.substring(0, 500));
        continue;
      }
      
      const data = responseData as { 
        error?: { code?: number; message?: string }; 
        result?: {
          transaction?: {
            message?: {
              accountKeys?: Array<{ pubkey?: string } | string>;
            };
          };
          meta?: {
            fee?: number;
            err?: unknown;
          };
        } | null;
      };

      // Log detailed response for debugging
      if (data.error || !data.result || data.result === null) {
        console.error(`[extractPayerFromTransaction] Version ${maxVersion} failed:`, {
          version: maxVersion,
          error: data.error,
          hasResult: !!data.result,
          resultIsNull: data.result === null,
          resultKeys: data.result ? Object.keys(data.result) : [],
          signature: signature.substring(0, 16) + '...',
        });
      } else {
        console.log(`[extractPayerFromTransaction] Version ${maxVersion} success, has transaction:`, !!data.result?.transaction);
      }

      // If we got a result, use it
      if (!data.error && data.result) {
        // Extract payer from this result
        const accountKeys = data.result.transaction?.message?.accountKeys;
        if (accountKeys && accountKeys.length > 0) {
          // Handle both formats: array of strings OR array of objects with pubkey
          let payerPubkey: string | undefined;
          const firstAccount = accountKeys[0];
          
          if (typeof firstAccount === 'string') {
            payerPubkey = firstAccount;
          } else if (firstAccount && typeof firstAccount === 'object' && 'pubkey' in firstAccount) {
            payerPubkey = firstAccount.pubkey;
          }

          if (payerPubkey && typeof payerPubkey === 'string') {
            console.log(`[extractPayerFromTransaction] Successfully extracted payer with version ${maxVersion}:`, payerPubkey);
            return payerPubkey;
          }
        }
      }
      
      // If we got an error or no result, try next version
      if (data.error || !data.result) {
        continue;
      }
    }
    
    // If we tried all versions and still no result, try one more time with a longer delay
    console.log('[extractPayerFromTransaction] Retrying after longer delay...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Final attempt with version 1 (versioned transactions)
    const finalResponse = await fetch(`${env.SOLANA_RPC_URL}`, {
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

    const finalData = await finalResponse.json() as { 
      error?: { code?: number; message?: string }; 
      result?: {
        transaction?: {
          message?: {
            accountKeys?: Array<{ pubkey?: string } | string>;
          };
        };
        meta?: {
          fee?: number;
          err?: unknown;
        };
      };
    };

    if (!finalData.error && finalData.result) {
      const accountKeys = finalData.result.transaction?.message?.accountKeys;
      if (accountKeys && accountKeys.length > 0) {
        let payerPubkey: string | undefined;
        const firstAccount = accountKeys[0];
        
        if (typeof firstAccount === 'string') {
          payerPubkey = firstAccount;
        } else if (firstAccount && typeof firstAccount === 'object' && 'pubkey' in firstAccount) {
          payerPubkey = firstAccount.pubkey;
        }

        if (payerPubkey && typeof payerPubkey === 'string') {
          console.log('[extractPayerFromTransaction] Successfully extracted payer after retry');
          return payerPubkey;
        }
      }
    }
    
    // If we tried all versions and still no result
    console.error('[extractPayerFromTransaction] RPC error or no result after trying all versions and retries:', {
      signature: signature.substring(0, 16) + '...',
      finalError: finalData.error,
      finalHasResult: !!finalData.result,
    });
    return null;
  } catch (error) {
    console.error('Failed to extract payer from transaction:', error);
    return null;
  }
}

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
    const versionsToTry = [0, 1]; // Try legacy first, then versioned
    let transactionData: {
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
    } | null = null;
    
    // Retry up to 3 times with increasing delays
    const maxRetries = 3;
    for (let retry = 0; retry < maxRetries; retry++) {
      // Add delay on retries (exponential backoff)
      if (retry > 0) {
        const delayMs = Math.min(1000 * Math.pow(2, retry - 1), 5000); // 1s, 2s, 4s max
        console.log(`[verifyPayment] Retry ${retry}/${maxRetries - 1} after ${delayMs}ms delay...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
      for (const maxVersion of versionsToTry) {
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
                maxSupportedTransactionVersion: maxVersion,
                commitment: 'confirmed',
              },
            ],
          }),
        });

        if (!response.ok) {
          console.error(`[verifyPayment] HTTP error ${response.status} for version ${maxVersion}, retry ${retry}`);
          continue;
        }

        const data = await response.json() as typeof transactionData;
        
        // If we got a result, use it
        if (!data.error && data.result) {
          transactionData = data;
          break;
        }
        
        // If we got an error or no result, try next version
        if (data.error || !data.result) {
          continue;
        }
      }
      
      // If we found a transaction, break out of retry loop
      if (transactionData && transactionData.result) {
        break;
      }
    }

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
      let tokenAccountPubkey: string | undefined;
      
      if (typeof accountKey === 'string') {
        tokenAccountPubkey = accountKey;
      } else if (accountKey && typeof accountKey === 'object' && 'pubkey' in accountKey) {
        tokenAccountPubkey = accountKey.pubkey;
      }
      
      if (tokenAccountPubkey === recipientTokenAccount) {
        recipientBalanceChange = postBalance;
        
        // Find corresponding pre-balance
        const preBalance = preBalances.find(b => b.accountIndex === postBalance.accountIndex);
        
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

