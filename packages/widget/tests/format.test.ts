import { describe, expect, it } from 'vitest'
import {
  formatAnchoredAt,
  ipfsGatewayUrl,
  stellarExpertUrl,
  truncateCid,
} from '../src/format'

describe('format helpers', () => {
  it('truncates a long CID symmetrically', () => {
    const cid = 'bafybeibcd' + 'x'.repeat(40)
    const short = truncateCid(cid, 6)
    expect(short).toBe('bafybe…xxxxxx')
  })

  it('keeps short CIDs intact', () => {
    expect(truncateCid('bafyabcd')).toBe('bafyabcd')
  })

  it('formats an anchored timestamp as UTC date+time', () => {
    expect(formatAnchoredAt('2026-07-24T08:15:00Z')).toBe('2026-07-24 08:15 UTC')
  })

  it('falls back to the original string when invalid', () => {
    expect(formatAnchoredAt('not a date')).toBe('not a date')
  })

  it('builds an ipfs://gateway URL', () => {
    expect(ipfsGatewayUrl('bafycid')).toBe('https://ipfs.io/ipfs/bafycid')
    expect(ipfsGatewayUrl('bafycid', 'https://gateway.pinata.cloud/ipfs/')).toBe(
      'https://gateway.pinata.cloud/ipfs/bafycid',
    )
  })

  it('builds a Stellar Expert URL with the correct network subdomain', () => {
    expect(stellarExpertUrl('mainnet', 'abc123')).toBe(
      'https://stellar.expert/explorer/public/tx/abc123',
    )
    expect(stellarExpertUrl('testnet', 'abc123')).toBe(
      'https://testnet.stellar.expert/explorer/public/tx/abc123',
    )
  })
})
