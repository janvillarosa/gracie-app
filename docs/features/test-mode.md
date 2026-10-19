# Test mode

A standing set of switches for test accounts, to try a real flow of the app in production: send
yourself a push, simulate a housemate's adds, run autopilot for your house. It is always deployed
and inert until an account is granted.

```
operator CLI ──▶ users.test_account = true ──▶ GET /me { test_account: true }
 testaccount grant <username>                              │
 (the only way in)                                         ▼
                                      Account settings ▸ Test mode (hidden for everyone else)
                                                           │ tap
                                                           ▼
                          POST /test/actions/{id} ── not a test account ──▶ 404 (as if absent)
                                                           │ ok
                          TouchesHouse and a member is not a test account ──▶ 409 (refused)
                                                           │ ok
                                  TestAction.Run as the caller ──▶ audit log + result line
```

## Granting

`testaccount grant <username>` / `revoke <username>` (`backend/cmd/testaccount`). No API route sets the
flag, so nobody can promote themselves. In production the entrypoint starts the server, so override it:

```bash
docker run --entrypoint /usr/local/bin/testaccount <image> grant jan
```

On Railway, run it as a one-off command in the service shell with the same environment as the server.

## Rules

- **Invisible to everyone else.** `GET /test/actions` and `POST /test/actions/{id}` answer a plain 404 to any
  account that is not a test account, before any rate limit is spent.
- **Never acts on real people.** An action marked `TouchesHouse` runs only when *every* member of the caller's house
  is a test account; otherwise it is refused with 409 and a message. Actions that stay with the caller
  (a push to their own devices) always run.
- **Real flows, not fakes.** Actions call the same services the app uses (the outbox, the dispatcher, the
  autopilot pass), so what you see is what users get.
- **Audited and limited.** Every run, and every refusal, is logged (`testmode: <user> ran <id>`); runs are
  limited to 1 per second with a burst of 5 per user.
- Test accounts' activity still feeds behavior analytics, so it can teach a house's forecast fake habits. Use a
  test-only house. Excluding test accounts from analytics is a planned follow-up.

## Actions

| Id | Touches house | What it does |
|---|---|---|
| `push.test` | no | Pushes a sample to your own devices now (no outbox, no switches). |
| `push.burst` | yes | A made-up housemate adds five items to the first list through the outbox; one merged notification follows after the merge window. |
| `push.checks` | yes | A made-up housemate checks off three items on the first list; one "is checking off" notification follows after the merge window. Each tap is its own run, so it works every time. |
| `push.trip` | no | Queues a sample trip reminder for you alone (it follows your trip switch). |
| `push.dispatch` | no | Sends every due notification now. |
| `autopilot.tick` | yes | Runs one assist pass for your house (it must be on assist mode). |

The push actions exist only when push is enabled (VAPID keys set).

## Adding a switch

Register a `services.TestAction` on `TestModeService` (see `UseNotify` / `UseAutopilot` in
`services/testmode.go`) with an id, label, description, `TouchesHouse` and a `Run`. Return a short result line.
The app lists whatever the server returns, so no frontend change is needed. Add a test, and a row above.

## Code map

`services/testmode.go` (registry, access rules, actions) · `services/notify_testmode.go` (push helpers) ·
`AutopilotService.TickRoom` · `handlers/testmode.go` · `cmd/testaccount` · frontend `TestModePanel`.
