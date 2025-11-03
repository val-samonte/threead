/**
 * Utilities for creating Solana transactions
 * General-purpose transaction creation using @solana/kit
 */

import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  address as parseAddress,
  createTransactionMessage,
  appendTransactionMessageInstruction,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  type KeyPairSigner,
} from '@solana/kit';
import { sendAndConfirmTransactionFactory } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

// SPL Token Program IDs (constants)
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

/**
 * Safe JSON stringify that handles BigInt values
 * Converts BigInt to string representation
 */
function safeStringify(obj: any, space?: number): string {
  return JSON.stringify(
    obj,
    (key, value) => (typeof value === 'bigint' ? value.toString() : value),
    space
  );
}

/**
 * Create SPL Token transfer instruction manually
 * This avoids dependency on @solana/web3.js PublicKey
 */
export function createTokenTransferInstruction(
  sourceTokenAccount: string,
  destinationTokenAccount: string,
  owner: string,
  amount: bigint
): { programId: string; keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>; data: Uint8Array } {
  
  // Instruction data:
  // Instruction discriminator: 3 (Transfer)
  // Amount: u64 (8 bytes, little-endian)
  const instructionData = new Uint8Array(9);
  instructionData[0] = 3; // Transfer instruction
  // Encode amount as u64 little-endian
  const amountBytes = new Uint8Array(8);
  const view = new DataView(amountBytes.buffer);
  view.setBigUint64(0, amount, true); // true = little-endian
  instructionData.set(amountBytes, 1);
  
  return {
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: sourceTokenAccount, isSigner: false, isWritable: true },
      { pubkey: destinationTokenAccount, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: instructionData,
  };
}

/**
 * Transfer native SOL from one account to another
 * 
 * @param signer - The signer (sender) for the transaction
 * @param fromAddress - Sender's wallet address (base58)
 * @param toAddress - Recipient's wallet address (base58)
 * @param amountLamports - Amount in lamports (e.g., 1_000_000_000 for 1 SOL)
 * @param rpcUrl - Solana RPC URL (optional, defaults to devnet)
 * @returns Transaction signature
 */
export async function createAndSendSolTransfer(
  signer: KeyPairSigner<string>,
  fromAddress: string,
  toAddress: string,
  amountLamports: number,
  rpcUrl: string = 'https://api.devnet.solana.com' // Official Solana devnet RPC
): Promise<string> {
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://'));
  
  // Parse addresses
  const toAddressParsed = parseAddress(toAddress);
  
  // Get recent blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  if (!latestBlockhash) {
    throw new Error('Failed to get latest blockhash');
  }
  
  // Use @solana-program/system to create the transfer instruction properly
  const transferInstruction = getTransferSolInstruction({
    source: signer,
    destination: toAddressParsed,
    amount: BigInt(amountLamports),
  });
  
  // Build transaction message following QuickNode guide pattern exactly
  // NOTE: Type assertion is necessary due to @solana/kit's transaction message building pattern
  // where each builder function returns a progressively more specific type that TypeScript can't infer
  let transactionMessage: any = createTransactionMessage({ version: 0 });
  transactionMessage = setTransactionMessageFeePayerSigner(signer, transactionMessage);
  transactionMessage = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage);
  transactionMessage = appendTransactionMessageInstruction(transferInstruction, transactionMessage);
  
  // Sign transaction using signTransactionMessageWithSigners (as per QuickNode guide)
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  
  // Get signature BEFORE sending (so we have it even if confirmation fails)
  const signature = getSignatureFromTransaction(signedTransaction);
  
  // Send and confirm transaction using factory pattern
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  
  try {
    // NOTE: Type assertion necessary due to @solana/kit's transaction type system limitations
    // The signed transaction has all required properties but TypeScript can't infer the exact type
    await sendAndConfirmTransaction(signedTransaction as any, { commitment: 'confirmed' });
  } catch (error: any) {
    // Transaction might have succeeded but confirmation failed
    // Try to verify the transaction actually succeeded with retries (RPC indexing delay)
    let verified = false;
    for (let retry = 0; retry < 3; retry++) {
      if (retry > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000 * retry)); // 1s, 2s delays
      }
      
      try {
        // Use latest transaction version (version 1) - @solana/kit creates versioned transactions
        // NOTE: Type assertion needed due to @solana/kit RPC type limitations
        const txResponse = await rpc.getTransaction(signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 } as any).send();
        if (txResponse && !txResponse.meta?.err) {
          // Transaction succeeded despite confirmation error
          verified = true;
          return signature;
        }
      } catch (verifyError) {
        // Continue to next retry
        continue;
      }
    }
    
    // Could not verify transaction after retries - likely failed
    throw error;
  }
  
  return signature;
}

/**
 * Create Associated Token Account instruction (idempotent version)
 * Uses idempotent instruction (variant 1) which won't fail if ATA already exists
 * Based on QuickNode guide: https://www.quicknode.com/guides/solana-development/spl-tokens/how-to-transfer-spl-tokens-on-solana
 */
function createAssociatedTokenAccountInstruction(
  payerSigner: KeyPairSigner<string>,
  associatedToken: string,
  owner: string,
  mint: string
): { programAddress: ReturnType<typeof parseAddress>; accounts: Array<{ address: ReturnType<typeof parseAddress>; role: number; signer?: KeyPairSigner<string> }>; data: Uint8Array } {
  const payerAddress = parseAddress(payerSigner.address);
  const associatedTokenAddress = parseAddress(associatedToken);
  const ownerAddress = parseAddress(owner);
  const mintAddress = parseAddress(mint);
  const associatedTokenProgramAddress = parseAddress(ASSOCIATED_TOKEN_PROGRAM_ID);
  const tokenProgramAddress = parseAddress(TOKEN_PROGRAM_ID);
  const systemProgramAddress = parseAddress(SYSTEM_PROGRAM_ID);
  
  // Role values (matching @solana-program/system):
  // 0 = readonly
  // 1 = writable
  // 2 = readonlySigner
  // 3 = writableSigner
  
  // CreateAssociatedTokenAccountIdempotent instruction format per SPL Token spec:
  // Program: Associated Token Program
  // Accounts (in order): payer (writable, signer), ATA (writable), owner (readonly), mint (readonly), system_program (readonly), token_program (readonly)
  // Data: instruction discriminator (variant 1 for idempotent) = [1]
  // The idempotent version uses discriminator byte 1 instead of 0
  // This allows the instruction to succeed even if the ATA already exists
  // Note: Use 'accounts' property (not 'accountMetas') to match getTransferSolInstruction format
  // Include signer property - @solana/kit will deduplicate it with the fee payer when building the transaction
  return {
    programAddress: associatedTokenProgramAddress,
    accounts: [
      { address: payerAddress, role: 3, signer: payerSigner }, // Payer (writableSigner - funds account creation, must sign)
      { address: associatedTokenAddress, role: 1 }, // ATA PDA to create (writable)
      { address: ownerAddress, role: 0 }, // Owner of the ATA (readonly)
      { address: mintAddress, role: 0 }, // Token mint (readonly)
      { address: systemProgramAddress, role: 0 }, // System Program (readonly)
      { address: tokenProgramAddress, role: 0 }, // Token Program (readonly)
    ],
    data: new Uint8Array([1]), // Instruction discriminator: 1 = CreateAssociatedTokenAccountIdempotent (variant 1)
  };
}

/**
 * Check if a token account exists
 */
async function tokenAccountExists(rpc: any, tokenAccount: string): Promise<boolean> {
  try {
    const accountInfo = await rpc.getAccountInfo(parseAddress(tokenAccount), { commitment: 'confirmed' }).send();
    return !!accountInfo.value;
  } catch {
    return false;
  }
}

/**
 * Create and send a USDC token transfer transaction
 * Automatically creates treasury ATA if it doesn't exist
 * 
 * @param signer - The signer (payer) for the transaction
 * @param payerAddress - Payer's wallet address (base58)
 * @param payerTokenAccount - Payer's USDC token account address (ATA)
 * @param treasuryTokenAccount - Treasury's USDC token account address (ATA)
 * @param treasuryWallet - Treasury wallet address (owner of the ATA)
 * @param usdcMint - USDC mint address
 * @param amount - Amount in smallest units (e.g., 100_000 for 0.1 USDC)
 * @param rpcUrl - Solana RPC URL (optional, defaults to devnet)
 * @returns Transaction signature
 */
export async function createAndSendTokenTransfer(
  signer: KeyPairSigner<string>,
  payerAddress: string,
  payerTokenAccount: string,
  treasuryTokenAccount: string,
  treasuryWallet: string,
  usdcMint: string,
  amount: number,
  rpcUrl: string = 'https://api.devnet.solana.com' // Official Solana devnet RPC
): Promise<string> {
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://'));
  
  // Parse addresses
  const payerTokenAccountAddress = parseAddress(payerTokenAccount);
  const treasuryAddress = parseAddress(treasuryTokenAccount);
  const tokenProgramAddress = parseAddress('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  
  // Check if treasury ATA exists, create it if not
  const treasuryExists = await tokenAccountExists(rpc, treasuryTokenAccount);
  
  // Get recent blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  if (!latestBlockhash) {
    throw new Error('Failed to get latest blockhash');
  }
  
  // Create token transfer instruction
  const transferInstruction = createTokenTransferInstruction(
    payerTokenAccount,
    treasuryTokenAccount,
    payerAddress,
    BigInt(amount)
  );
  
  // Build transaction message following QuickNode guide pattern
  // NOTE: Type assertion is necessary due to @solana/kit's transaction message building pattern
  // where each builder function returns a progressively more specific type that TypeScript can't infer
  let transactionMessage: any = createTransactionMessage({ version: 0 });
  transactionMessage = setTransactionMessageFeePayerSigner(signer, transactionMessage);
  transactionMessage = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage);
  
  // If treasury ATA doesn't exist, create it first
  // Note: Error 4615050 "Provided owner is not allowed" can occur if ATA already exists
  // We'll try to create it, but if it fails with this specific error, we'll retry without ATA creation
  let shouldCreateATA = !treasuryExists;
  if (shouldCreateATA) {
    // Pass signer directly so @solana/kit can properly match it with the fee payer
    const createATAInstruction = createAssociatedTokenAccountInstruction(
      signer,
      treasuryTokenAccount,
      treasuryWallet,
      usdcMint
    );
    transactionMessage = appendTransactionMessageInstruction(createATAInstruction, transactionMessage);
  }
  
  // Add transfer instruction
  // Role values: 0 = readonly, 1 = writable, 2 = readonlySigner, 3 = writableSigner
  // Note: Use 'accounts' property (not 'accountMetas') to match getTransferSolInstruction format
  // Include signer property - @solana/kit will deduplicate it with the fee payer when building the transaction
  transactionMessage = appendTransactionMessageInstruction(
    {
      programAddress: tokenProgramAddress,
      accounts: [
        { address: payerTokenAccountAddress, role: 1 }, // Source token account (writable)
        { address: treasuryAddress, role: 1 }, // Destination token account (writable)
        { address: parseAddress(payerAddress), role: 2, signer }, // Owner (readonlySigner)
      ],
      data: transferInstruction.data,
    },
    transactionMessage
  );
  
  // Sign transaction using signTransactionMessageWithSigners
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  
  // Get signature BEFORE sending (so we have it even if confirmation fails)
  const signature = getSignatureFromTransaction(signedTransaction);
  
  // Send and confirm transaction using factory pattern
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  
  try {
    // NOTE: Type assertion necessary due to @solana/kit's transaction type system limitations
    // The signed transaction has all required properties but TypeScript can't infer the exact type
    await sendAndConfirmTransaction(signedTransaction as any, { commitment: 'confirmed' });
    
    // Verify transaction actually succeeded on-chain
    // Use latest transaction version (version 1) - @solana/kit creates versioned transactions
    // NOTE: Type assertion needed due to @solana/kit RPC type limitations
    const txResponse = await rpc.getTransaction(signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 } as any).send();
    if (txResponse && txResponse.meta?.err) {
      console.error('[Token Transfer] Transaction confirmed but has error:', txResponse.meta.err);
      throw new Error(`Transaction failed: ${JSON.stringify(txResponse.meta.err)}`);
    }
  } catch (error: any) {
    // Check for common Solana errors and provide helpful messages
    // Log the full error structure for debugging
    const errorCode = error?.cause?.context?.__code || error?.context?.cause?.context?.__code || error?.code;
    const errorMessage = error?.message || error?.cause?.message || 'Unknown error';
    
    // Log full error for debugging if it's not a known error code
    if (!errorCode || (errorCode !== 4615026 && errorCode !== 4615025 && errorCode !== 4615050)) {
      console.error('[Token Transfer] Error details:', {
        errorCode,
        errorMessage,
        errorKeys: error ? Object.keys(error) : [],
        errorCause: error?.cause ? Object.keys(error.cause) : [],
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
      });
    }
    
    // Error 4615026 = InsufficientFundsForFee (need SOL for transaction fees)
    // Only trigger if we're CERTAIN this is the issue (check account balance first)
    if (errorCode === 4615026) {
      // Verify account actually has no SOL before throwing this error
      // If account has SOL, this might be a different issue
      try {
        // Reuse the existing rpc instance created at the start of the function
        const balanceResponse = await rpc.getBalance(parseAddress(payerAddress)).send();
        const balance = balanceResponse.value; // Extract the Lamports value from the response
        if (balance > 0n) {
          // Account has SOL, so this error is misleading
          console.warn(`[Token Transfer] Error 4615026 but account has ${balance} lamports SOL. Actual error: ${errorMessage}`);
          throw new Error(
            `Transaction failed with error code 4615026, but account has SOL balance.\n` +
            `This might be a different issue. Original error: ${errorMessage}\n` +
            `Account: ${payerAddress}, Balance: ${balance} lamports`
          );
        }
      } catch {
        // If balance check fails, proceed with original error message
        console.warn('[Token Transfer] Could not verify balance, proceeding with original error');
      }
      
      throw new Error(
        `Insufficient SOL for transaction fees. Payer ${payerAddress} needs SOL to pay transaction fees.\n` +
        `Fund the payer with: solana airdrop 1 ${payerAddress} (devnet)\n` +
        `Original error: ${errorMessage}`
      );
    }
    
    // Error 4615025 = InsufficientFunds (need USDC for transfer)
    if (errorCode === 4615025) {
      throw new Error(
        `Insufficient USDC balance. Payer ${payerAddress} needs USDC in their token account.\n` +
        `Payer token account: ${payerTokenAccount}\n` +
        `Original error: ${errorMessage}`
      );
    }
    
    // Check if error is "Provided owner is not allowed" (4615050) - ATA might already exist
    if (errorCode === 4615050 && shouldCreateATA) {
      // Retry transaction without ATA creation instruction
      // NOTE: Type assertion is necessary due to @solana/kit's transaction message building pattern
      let retryTransactionMessage: any = createTransactionMessage({ version: 0 });
      retryTransactionMessage = setTransactionMessageFeePayerSigner(signer, retryTransactionMessage);
      retryTransactionMessage = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, retryTransactionMessage);
      
      // Add only the transfer instruction
      retryTransactionMessage = appendTransactionMessageInstruction(
        {
          programAddress: tokenProgramAddress,
          accounts: [
            { address: payerTokenAccountAddress, role: 1 }, // Source token account (writable)
            { address: treasuryAddress, role: 1 }, // Destination token account (writable)
            { address: parseAddress(payerAddress), role: 2, signer }, // Owner (readonlySigner)
          ],
          data: transferInstruction.data,
        },
        retryTransactionMessage
      );
      
      const retrySignedTransaction = await signTransactionMessageWithSigners(retryTransactionMessage);
      const retrySignature = getSignatureFromTransaction(retrySignedTransaction);
      
      try {
        // NOTE: Type assertion necessary due to @solana/kit's transaction type system limitations
        await sendAndConfirmTransaction(retrySignedTransaction as any, { commitment: 'confirmed' });
        return retrySignature;
      } catch (retryError: any) {
        console.error('[Token Transfer] Retry also failed:', retryError);
        throw retryError; // Re-throw the retry error
      }
    }
    
    // Transaction might have succeeded but confirmation failed
    // Try to verify the transaction actually succeeded with retries (RPC indexing delay)
    let verified = false;
    for (let retry = 0; retry < 3; retry++) {
      if (retry > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000 * retry)); // 1s, 2s delays
      }
      
      try {
        // Use latest transaction version (version 1) - @solana/kit creates versioned transactions
        // NOTE: Type assertion needed due to @solana/kit RPC type limitations
        const txResponse = await rpc.getTransaction(signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 } as any).send();
        if (txResponse && !txResponse.meta?.err) {
          // Transaction succeeded despite confirmation error
          verified = true;
          return signature;
        }
      } catch (verifyError) {
        // Continue to next retry
        continue;
      }
    }
    
    // Could not verify transaction after retries - likely failed
    throw error;
  }
  
  return signature;
}

