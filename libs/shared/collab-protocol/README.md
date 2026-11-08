# shared-collab-protocol

Document names, Yjs document helpers, stateless messages and close reasons shared by the real-time
server (`api-collab-server`) and its clients.

## Real-time contract

**Connecting**

- Endpoint: `/collab` on the API origin (same origin as the web app; the dev server proxies it with
  `ws: true`).
- Documents: `session:<id>:board` and `session:<id>:notes` (`docName.board(id)` / `docName.notes(id)`).
- Provider: pass `token: 'cookie'`. The value is ignored; the session or candidate cookie sent with the
  upgrade authenticates.

**No identity at upgrade → HTTP 401**

- The upgrade is refused with HTTP 401 before any Hocuspocus message. The provider sees a 1006 close,
  `onAuthenticationFailed` never fires, and it retries forever.
- Clients must detect this themselves (e.g. after N failed opens, probe the REST identity endpoint) and
  show the login or invalid-link screen.
- The same happens for an expired interviewer session, and for an old candidate cookie after the
  invite was regenerated.

**Rejected document → `onAuthenticationFailed({ reason })`**

- `reason` is one of `forbidden | not_started | session_ended | invite_revoked` (`CloseReason`).
- The provider does not retry.
- `not_started`: show a waiting room that polls REST and reconnects once the session has started.

**Disconnected by policy → close code 4403**

- `POLICY_CLOSE_CODE` (4403), with reason `session_ended` or `invite_revoked`.
- The provider auto-reconnects on it, so clients must call `provider.destroy()` on 4403.

**Server shutdown**

- Sockets are terminated (1006). Reconnecting is correct.

**Session state**

- `session.state` arrives via `onStateless`; parse it with `parseServerMessage`.
- It is sent on connect and on every session change, ordered by session version on the server.
- Do not assume it arrives before `synced`.

**Access**

- Interviewers: board and notes are writable while the session is open, read-only after it ends.
- Candidates: the board only, while the session is live; they never get notes.
