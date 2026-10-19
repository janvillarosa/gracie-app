# Push notifications

Web Push to Android and iOS, delivered after the app is closed. Spec/plan:
`/Users/janvillarosa/.claude/plans/push-notifications-for-bauhouse-compiled-heron.md` (kept outside the repo).

**Off by default.** Without `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` the server mounts no push
routes, writes no outbox jobs and starts no goroutines. Generate keys with
`cd backend && go run ./cmd/gen-vapid`, set them as Railway variables, and never rotate them casually:
a new pair invalidates every device's subscription.

## What is sent

| Kind (`PushKind*`) | When | Who | Switch |
|---|---|---|---|
| `item_adds` | A person adds items to a list. Adds by the same person to the same list merge for 90 s into one notification ("Ana added Milk, Eggs and 2 more"). | The rest of the house, never the actor. | `itemAdds` |
| `autopilot` | Assist mode added items (`CreateSystemItem` with source autopilot). One tick's adds merge. | The whole house. | `autopilot` |
| `trip` | A timed to-do starts within the hour, or a booking within 24 h. Sent once per item and start time; sent again if the start moves. | The trip's travellers (all members when none are set). | `tripReminders` |

All switches default on (`User.Notifies`). They live in `User.Preferences` (`notify_*`) and are
read/written through `GET`/`PUT /me/notifications` (camelCase JSON, partial updates).

## How it works

```
event -> NotifyService.enqueue -> push_jobs (Mongo outbox, coalesced by key)
                                        |
        RunDispatch (every 15 s, any number of instances)
                                        |  Claim: pending & due, or sending with a lapsed lease
                                        v
        recipients = house members - actor, filtered by switch -> push_subscriptions
                                        |
                       push.WebPush.Send (VAPID, aes128gcm) -> FCM / APNs
                                        |
                              sw.js push handler -> showNotification
```

- **Outbox, not inline.** The job is written after the domain write and is not in its transaction:
  a crash between the two loses one notification, never the item (at-most-once on enqueue).
- **Coalescing.** A partial unique index allows one *pending* job per `coalesce_key`; an upsert merges
  later adds into it (`$inc` count, `$push` up to 5 names). Once a job is claimed, new adds start a fresh one.
- **Delivery.** `Claim` is a `findOneAndUpdate` with a lease, so instances never double-send. A lapsed
  lease is retried. A 429/5xx/network failure retries with backoff up to 5 attempts; a retry may reach a
  device twice, and the notification `tag` makes the phone replace the first copy. 404/410 deletes the device.
- **Trip reminders** use `once` jobs keyed `trip:todo:<id>:<start>` / `trip:booking:<id>:<start>`; a done job is
  kept 7 days (TTL on `expire_at`), which is what makes them send once.
- **Wording happens at send time** from the stored names and count, so a merged job reads well. Payload is
  `{title, body, url, tag}`, encrypted end to end by Web Push. No user ids or keys in it.

## Security

- `push.ValidateEndpoint` accepts only `https` URLs, no port or credentials, on known push hosts
  (FCM, Apple, Mozilla, Windows). It runs on subscribe **and** on send, and redirects are never followed
  (SSRF guard).
- A subscription's `p256dh` and `auth` are AES-GCM encrypted at rest with the same key as passwords.
- An endpoint is unique: a device that signs in as someone else moves to that user. Only the owner can
  delete it. At most 10 devices per user (oldest dropped). Deleting an account deletes its devices.

## Platform limits

- **Android Chrome:** works in the browser or installed.
- **iOS 16.4+:** only after Add to Home Screen; permission must be requested from a tap; every push must
  show a notification (silent pushes get the subscription revoked).
- Push needs HTTPS (localhost is allowed for development).

## Routes (auth required, mounted only when push is enabled)

`GET /push/key` -> `{publicKey}` · `PUT /push/subscriptions` (`PushSubscription.toJSON()` + `userAgent`, idempotent) ·
`DELETE /push/subscriptions` `{endpoint}` · `GET`/`PUT /me/notifications`.

## Config

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:`), `PUSH_DISPATCH_EVERY` (15s),
`PUSH_COALESCE` (90s), `PUSH_REMIND_EVERY` (15m).

## Code map

`internal/push` (sender, endpoint validation) · `services/notify_service.go` (devices, switches, outbox,
dispatcher) · `services/notify_trips.go` (reminders) · `store/mongo/push_repo.go` · `handlers/push.go` ·
hooks: `ListService.UseNotifier`, `UserService.UsePushSubscriptions`.
