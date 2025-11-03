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
  
  console.log('[SOL Transfer] Source (faucet) address:', fromAddress);
  console.log('[SOL Transfer] Destination (payer) address:', toAddress);
  console.log('[SOL Transfer] Amount:', amountLamports, 'lamports');
  console.log('[SOL Transfer] Instruction accounts:', transferInstruction.accounts.map((a, i) => ({
    index: i,
    address: a.address,
    role: a.role,
    signer: 'signer' in a ? !!a.signer : false,
  })));
  console.log('[SOL Transfer] Instruction program:', transferInstruction.programAddress);
  
  // Build transaction message following QuickNode guide pattern exactly
  // NOTE: Type assertion is necessary due to @solana/kit's transaction message building pattern
  // where each builder function returns a progressively more specific type that TypeScript can't infer
  let transactionMessage: any = createTransactionMessage({ version: 0 });
  transactionMessage = setTransactionMessageFeePayerSigner(signer, transactionMessage);
  console.log('[SOL Transfer] Fee payer set:', transactionMessage.feePayer?.address);
  transactionMessage = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage);
  transactionMessage = appendTransactionMessageInstruction(transferInstruction, transactionMessage);
  console.log('[SOL Transfer] Instructions count:', transactionMessage.instructions.length);
  console.log('[SOL Transfer] Static account keys count:', transactionMessage.staticAccountKeys?.length || 'N/A');
  
  // Sign transaction using signTransactionMessageWithSigners (as per QuickNode guide)
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  console.log('[SOL Transfer] Transaction signed, has signatures:', !!signedTransaction.signatures);
  
  // Get signature BEFORE sending (so we have it even if confirmation fails)
  const signature = getSignatureFromTransaction(signedTransaction);
  console.log('[SOL Transfer] Transaction signature:', signature);
  
  // Send and confirm transaction using factory pattern
  console.log('[SOL Transfer] Sending transaction...');
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  
  try {
    // NOTE: Type assertion necessary due to @solana/kit's transaction type system limitations
    // The signed transaction has all required properties but TypeScript can't infer the exact type
    await sendAndConfirmTransaction(signedTransaction as any, { commitment: 'confirmed' });
    console.log('[SOL Transfer] Transaction confirmed!');
  } catch (error: any) {
    // Transaction might have succeeded but confirmation failed
    // Check if transaction actually exists and succeeded
    console.warn('[SOL Transfer] Confirmation error, but transaction may have succeeded:', error.message);
    console.warn('[SOL Transfer] Signature:', signature, '- Check on explorer if transaction succeeded');
    
    // Try to verify the transaction actually succeeded
    try {
      // Use latest transaction version (version 1) - @solana/kit creates versioned transactions
      // NOTE: Type assertion needed due to @solana/kit RPC type limitations
      const txResponse = await rpc.getTransaction(signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 } as any).send();
      if (txResponse && !txResponse.meta?.err) {
        console.log('[SOL Transfer] Transaction verification: SUCCESS (transaction succeeded despite confirmation error)');
        return signature;
      } else {
        throw error; // Transaction actually failed, re-throw
      }
    } catch (verifyError) {
      // Can't verify, but transaction might still succeed - return signature anyway
      // The caller can verify later
      console.warn('[SOL Transfer] Could not verify transaction, but signature is:', signature);
      return signature;
    }
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
 * Automatically creates recipient ATA if it doesn't exist
 * 
 * @param signer - The signer (payer) for the transaction
 * @param payerAddress - Payer's wallet address (base58)
 * @param payerTokenAccount - Payer's USDC token account address (ATA)
 * @param recipientTokenAccount - Recipient's USDC token account address (ATA)
 * @param recipientOwner - Recipient's wallet address (owner of the ATA)
 * @param usdcMint - USDC mint address
 * @param amount - Amount in smallest units (e.g., 100_000 for 0.1 USDC)
 * @param rpcUrl - Solana RPC URL (optional, defaults to devnet)
 * @returns Transaction signature
 */
export async function createAndSendTokenTransfer(
  signer: KeyPairSigner<string>,
  payerAddress: string,
  payerTokenAccount: string,
  recipientTokenAccount: string,
  recipientOwner: string,
  usdcMint: string,
  amount: number,
  rpcUrl: string = 'https://api.devnet.solana.com' // Official Solana devnet RPC
): Promise<string> {
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://'));
  
  // Parse addresses
  const payerTokenAccountAddress = parseAddress(payerTokenAccount);
  const recipientAddress = parseAddress(recipientTokenAccount);
  const tokenProgramAddress = parseAddress('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  
  // Check if recipient ATA exists, create it if not
  const recipientExists = await tokenAccountExists(rpc, recipientTokenAccount);
  console.log('[Token Transfer] Recipient ATA exists:', recipientExists);
  
  // Get recent blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  if (!latestBlockhash) {
    throw new Error('Failed to get latest blockhash');
  }
  
  // Create token transfer instruction
  const transferInstruction = createTokenTransferInstruction(
    payerTokenAccount,
    recipientTokenAccount,
    payerAddress,
    BigInt(amount)
  );
  
  console.log('[Token Transfer] Payer address:', payerAddress);
  console.log('[Token Transfer] Payer token account (source):', payerTokenAccount);
  console.log('[Token Transfer] Recipient token account (destination):', recipientTokenAccount);
  console.log('[Token Transfer] Amount:', amount, 'smallest units');
  console.log('[Token Transfer] Token program:', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  
  // Build transaction message following QuickNode guide pattern
  // NOTE: Type assertion is necessary due to @solana/kit's transaction message building pattern
  // where each builder function returns a progressively more specific type that TypeScript can't infer
  let transactionMessage: any = createTransactionMessage({ version: 0 });
  transactionMessage = setTransactionMessageFeePayerSigner(signer, transactionMessage);
  console.log('[Token Transfer] Fee payer set:', transactionMessage.feePayer?.address);
  transactionMessage = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage);
  
  // If recipient ATA doesn't exist, create it first
  // Note: Error 4615050 "Provided owner is not allowed" can occur if ATA already exists
  // We'll try to create it, but if it fails with this specific error, we'll retry without ATA creation
  let shouldCreateATA = !recipientExists;
  if (shouldCreateATA) {
    console.log('[Token Transfer] Creating recipient ATA before transfer...');
    console.log('[Token Transfer] Recipient owner address:', recipientOwner);
    
    // Check if owner account exists first
    try {
      const ownerAccountInfo = await rpc.getAccountInfo(parseAddress(recipientOwner), { commitment: 'confirmed' }).send();
      console.log('[Token Transfer] Owner account exists:', !!ownerAccountInfo.value);
      if (!ownerAccountInfo.value) {
        console.warn('[Token Transfer] Warning: Owner account does not exist on-chain. ATA creation may fail.');
      }
    } catch (err) {
      console.warn('[Token Transfer] Could not check owner account:', err);
    }
    
    // Pass signer directly so @solana/kit can properly match it with the fee payer
    const createATAInstruction = createAssociatedTokenAccountInstruction(
      signer,
      recipientTokenAccount,
      recipientOwner,
      usdcMint
    );
    console.log('[Token Transfer] ATA instruction program:', createATAInstruction.programAddress);
    console.log('[Token Transfer] ATA instruction accounts:', createATAInstruction.accounts.map((a, i) => ({
      index: i,
      address: a.address,
      role: a.role,
      hasSigner: 'signer' in a && !!a.signer,
    })));
    console.log('[Token Transfer] Fee payer address:', signer.address);
    // parseAddress already returns Address type, so it should work
    transactionMessage = appendTransactionMessageInstruction(createATAInstruction, transactionMessage);
    console.log('[Token Transfer] ATA creation instruction added');
    console.log('[Token Transfer] Transaction account keys after ATA instruction:', transactionMessage.staticAccountKeys?.length || 'N/A');
    if (transactionMessage.staticAccountKeys) {
      console.log('[Token Transfer] Transaction account keys:', transactionMessage.staticAccountKeys.map((k: any, i: number) => ({
        index: i,
        address: k.address,
      })));
    }
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
        { address: recipientAddress, role: 1 }, // Destination token account (writable)
        { address: parseAddress(payerAddress), role: 2, signer }, // Owner (readonlySigner)
      ],
      data: transferInstruction.data,
    },
    transactionMessage
  );
  console.log('[Token Transfer] Instructions count:', transactionMessage.instructions.length);
  console.log('[Token Transfer] Static account keys count:', transactionMessage.staticAccountKeys?.length || 'N/A');
  
  // Debug: Log transaction message structure before signing
  console.log('[Token Transfer] Transaction message structure before signing:', {
    hasInstructions: !!transactionMessage.instructions,
    instructionsCount: transactionMessage.instructions?.length || 0,
    hasFeePayer: !!transactionMessage.feePayer,
    feePayerAddress: transactionMessage.feePayer?.address,
    hasStaticAccountKeys: !!transactionMessage.staticAccountKeys,
    staticAccountKeysCount: transactionMessage.staticAccountKeys?.length || 0,
    allKeys: Object.keys(transactionMessage),
  });
  
  // Debug: Log all instructions and their accounts
  if (transactionMessage.instructions) {
    console.log('[Token Transfer] All instructions in transaction:');
    transactionMessage.instructions.forEach((inst: any, idx: number) => {
      console.log(`[Token Transfer] Instruction ${idx}:`, {
        programAddress: inst.programAddress,
        accountsCount: inst.accounts?.length || 0,
        accounts: inst.accounts?.map((a: any, i: number) => ({
          index: i,
          address: typeof a.address === 'string' ? a.address : a.address?.toString(),
          role: a.role,
          hasSigner: 'signer' in a && !!a.signer,
        })) || [],
        dataLength: inst.data?.length || 0,
      });
    });
  }
  
  // Sign transaction using signTransactionMessageWithSigners
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  console.log('[Token Transfer] Transaction signed, has signatures:', !!signedTransaction.signatures);
  
  // Log signed transaction structure to debug account keys issue
  console.log('[Token Transfer] Signed transaction structure:', {
    keys: Object.keys(signedTransaction),
    hasLifetimeConstraint: !!(signedTransaction as any).lifetimeConstraint,
    hasMessageBytes: !!(signedTransaction as any).messageBytes,
    messageBytesLength: (signedTransaction as any).messageBytes?.length || 0,
    hasSignatures: !!signedTransaction.signatures,
    signaturesCount: signedTransaction.signatures ? Object.keys(signedTransaction.signatures).length : 0,
  });
  
  // Get signature BEFORE sending (so we have it even if confirmation fails)
  const signature = getSignatureFromTransaction(signedTransaction);
  console.log('[Token Transfer] Transaction signature:', signature);
  
  // Send and confirm transaction using factory pattern
  console.log('[Token Transfer] Sending transaction...');
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  
  try {
    // NOTE: Type assertion necessary due to @solana/kit's transaction type system limitations
    // The signed transaction has all required properties but TypeScript can't infer the exact type
    await sendAndConfirmTransaction(signedTransaction as any, { commitment: 'confirmed' });
    console.log('[Token Transfer] Transaction confirmed!');
    
    // Verify transaction actually succeeded on-chain
    // Use latest transaction version (version 1) - @solana/kit creates versioned transactions
    // NOTE: Type assertion needed due to @solana/kit RPC type limitations
    const txResponse = await rpc.getTransaction(signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 } as any).send();
    if (txResponse && txResponse.meta?.err) {
      console.error('[Token Transfer] Transaction confirmed but has error:', txResponse.meta.err);
      throw new Error(`Transaction failed: ${JSON.stringify(txResponse.meta.err)}`);
    }
    console.log('[Token Transfer] Transaction verified on-chain: SUCCESS');
  } catch (error: any) {
    // Check if error is "Provided owner is not allowed" (4615050) - ATA might already exist
    const errorCode = error?.cause?.context?.__code || error?.context?.cause?.context?.__code;
    if (errorCode === 4615050 && shouldCreateATA) {
      console.warn('[Token Transfer] ATA creation failed with "Provided owner is not allowed" - retrying without ATA creation (ATA may already exist)');
      
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
            { address: recipientAddress, role: 1 }, // Destination token account (writable)
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
        console.log('[Token Transfer] Retry transaction confirmed!');
        return retrySignature;
      } catch (retryError: any) {
        console.error('[Token Transfer] Retry also failed:', retryError);
        throw retryError; // Re-throw the retry error
      }
    }
    
    // Transaction might have succeeded but confirmation failed
    // Log the full error details
    console.error('[Token Transfer] Full error details:', safeStringify(error, 2));
    console.error('[Token Transfer] Error message:', error.message);
    console.error('[Token Transfer] Error name:', error.name);
    if (error.cause) {
      console.error('[Token Transfer] Error cause:', safeStringify(error.cause, 2));
    }
    
    // Check if transaction actually exists and succeeded
    console.warn('[Token Transfer] Confirmation error, but transaction may have succeeded:', error.message);
    console.warn('[Token Transfer] Signature:', signature, '- Check on explorer if transaction succeeded');
    
    // Try to verify the transaction actually succeeded
    try {
      // Use latest transaction version (version 1) - @solana/kit creates versioned transactions
      // NOTE: Type assertion needed due to @solana/kit RPC type limitations
      const txResponse = await rpc.getTransaction(signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 } as any).send();
      if (txResponse && !txResponse.meta?.err) {
        console.log('[Token Transfer] Transaction verification: SUCCESS (transaction succeeded despite confirmation error)');
        return signature;
      } else {
        throw error; // Transaction actually failed, re-throw
      }
    } catch (verifyError) {
      // Can't verify, but transaction might still succeed - return signature anyway
      // The caller can verify later
      console.warn('[Token Transfer] Could not verify transaction, but signature is:', signature);
      return signature;
    }
  }
  
  return signature;
}

