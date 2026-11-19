import { ROBINHOOD_CHAIN } from "./constants.ts";

export interface SiweMessageFields {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId?: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

/**
 * Formats a canonical EIP-4361 Sign-In with Ethereum message for Robinhood Chain (4663).
 */
export function buildSiweMessage(fields: SiweMessageFields): string {
  const chainId = fields.chainId ?? ROBINHOOD_CHAIN.chainId;
  if (!/^0x[a-fA-F0-9]{40}$/.test(fields.address)) {
    throw new Error(`Invalid EVM address: ${fields.address}`);
  }
  if (fields.nonce.length < 16) {
    throw new Error("SIWE nonce must be at least 16 characters");
  }
  return [
    `${fields.domain} wants you to sign in with your Ethereum account:`,
    fields.address,
    "",
    fields.statement,
    "",
    `URI: ${fields.uri}`,
    `Version: 1`,
    `Chain ID: ${chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    `Expiration Time: ${fields.expirationTime}`,
  ].join("\n");
}
