# api-collab-server

Hocuspocus real-time server attached to the API's HTTP server at `/collab`. The client-facing contract
(endpoint, auth failures, close codes, `session.state`) is documented in
[`shared-collab-protocol`](../../shared/collab-protocol/README.md#real-time-contract).

Responsibilities: cookie authentication at upgrade and per-document authorization; loading and storing
Yjs documents in S3 (with retries and checkpoints); broadcasting `session.state` and enforcing end of
session and invite revocation (`sessionChanged`); a bounded, flushing `close()` for graceful shutdown.
