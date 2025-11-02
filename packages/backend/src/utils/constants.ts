/**
 * USDC mint addresses by network (for reference/defaults)
 * Devnet: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (Circle devnet USDC)
 * Mainnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 * 
 * Note: USDC_MINT should be configured via environment variable (env.USDC_MINT)
 * This constant is only for default values in scripts/tests
 */
export const USDC_MINT_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Solana cluster (devnet for development, mainnet for production)
 */
export type SolanaCluster = 'devnet' | 'mainnet';

