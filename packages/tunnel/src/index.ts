export const VERSION = '0.1.0'

export { tunnel, RelayPool } from './transport.js'
export type { TunnelOptions, TunnelTransport, TunnelEvent, RelayStatus, RelayState } from './transport.js'
export { canonicalJson, canonicalEntity, normalize, sortEntities, hashEntities, hashQuery, sha256Text } from './canonical.js'
export { RelayDisagreement, RelayUnavailableError, RpcResponseError, NoHealthyRelayError, findTunnelError } from './errors.js'
export type { RelayAnswer } from './errors.js'
