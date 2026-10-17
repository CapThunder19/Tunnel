export const VERSION = '0.1.0'

export { tunnel, RelayPool } from './transport.js'
export type { TunnelOptions, TunnelTransport, TunnelEvent, RelayStatus, RelayState } from './transport.js'
export { canonicalJson, canonicalEntity, normalize, sortEntities, hashEntities, hashQuery, sha256Text } from './canonical.js'
export { RelayDisagreement, RelayUnavailableError, RpcResponseError, NoHealthyRelayError, findTunnelError } from './errors.js'
export type { RelayAnswer } from './errors.js'
export {
  createStamps,
  signOffline,
  encode,
  decode,
  splitSms,
  joinSms,
  inspect,
  broadcast,
  OfflineNetworkCallError,
  ARKIV_ADDRESS,
  STAMP_GAS,
  STAMP_MAX_FEE,
  STAMP_VALUE,
  TEXT_PREFIX,
} from './offline.js'
export type { Stamp, SignOfflineOptions, InspectedTx, InspectedCreate } from './offline.js'
export { takeSnapshot, attest, makeBundle, SELECT_ALL } from './snapshot.js'
export { verifyOffline, attestationMessage, BUNDLE_FORMAT } from './verify.js'
export type { Snapshot, Attestation, Bundle, VerifyResult, WitnessResult } from './verify.js'
