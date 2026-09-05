# device/flippy-js — the Flipper app (v1)

The Flipper is the physical approval factor. This app shows a proposal and returns the
human's decision. It holds no key: the bridge signs once the device says yes.

## Why JavaScript and not C

The Flipper's JS engine (mJS) has no crypto, no bigint and no USB access — so it cannot
produce a secp256k1 signature. It *can* draw a dialog and read/write the SD card, which is
all v1 needs. On-device signing is a C app; see `../flippy-c/README.md` and SPEC §1.

## Protocol

The bridge writes `/ext/apps_data/flippy/inbox.json`:

```json
{ "id": "0x…", "short": "0x1a2b…9f0e", "action": "SEND",
  "amount": "0.010 ETH", "counterparty": "0xAb12…F9e3", "chain": "Sepolia", "seq": 1 }
```

This app writes `/ext/apps_data/flippy/outbox.json`:

```json
{ "id": "0x…", "seq": 1, "approved": true, "at": 1757000000000 }
```

`seq` increments per request; a request whose `seq` we have already answered is ignored, so
a stale inbox can never be re-approved.

## Install and run

```bash
pnpm --filter @flippy/bridge flipper:install   # copies this file to /ext/apps/Scripts/
```

Then on the device: `Apps -> Scripts -> flippy.js`.

## Before writing any more code: Spike 1

Confirm the laptop can read and write SD-card files over the USB CLI *while this app is in
the foreground*. Record the result in `docs/spikes.md`. If it fails, the fallbacks are in
SPEC §8 Risk 1 — and note that `dialog.custom` blocking is the most likely culprit, in which
case the polling loop above is already the shape you want.

Momentum's JS API is a superset of the official one, but verify these exist on the firmware
that is actually flashed: `storage.exists/read/write/remove`, `dialog.custom`,
`notification.blink/success/error`, and the global `delay`.
