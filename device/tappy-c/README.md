# device/tappy-c — on-device signing (M6 stretch, not started)

**Do not start this until M5 is done.** It is cut line #1.

## What it buys us

v1's claim is "nothing executes without a human physically present". This changes the claim
to "the key is generated on the Flipper and never leaves it" — which is the difference
between a presence factor and a hardware wallet, and it is the strongest version of the pitch.

## Verified feasibility (2026-09-04, see SPEC §1)

- The JS engine cannot do this: no crypto, no bigint, no USB. It must be a C app.
- FlipBIP (`github.com/xtruan/FlipBIP`) already runs trezor-crypto's secp256k1 and keccak256
  on this exact hardware via `fap_private_libs`. It derives Ethereum addresses on-device but
  has no signing feature; `ecdsa_sign_digest` is in the vendored library.
- micro-ecc benchmarks on Cortex-M4 scale to roughly **110–250 ms per signature at 64 MHz**.
- The STM32WB55 has a PKA that natively supports secp256k1 ECDSA (RM0434 Table 150, ~82 ms).
  The SDK exports the LL register header, but no Flipper app has ever used it. Stretch of the stretch.
- The firmware's own mbedtls has secp256k1 disabled and its ECDSA symbols are not linkable
  from an app, so we must bundle our own curve code.

## Plan, in order, with a stop rule at every step

1. `pip install ufbt`; point it at **Momentum's** SDK (the device runs Momentum, and an app's
   major API version must match). `ufbt create APPID=tappy`, then `ufbt launch` a hello world.
   **Stop rule: if this is not on the device within 2 hours, abandon M6 and keep v1.**
2. Vendor the trezor-crypto subset from FlipBIP (`secp256k1`, `ecdsa`, `sha3`, `hasher`, `rand`,
   `memzero`, `bignum`) as `fap_private_libs`. RAM is the risk here — FlipBIP's README warns it
   already runs near the limit. Strip everything not needed for signing.
3. Key generation: `furi_hal_random_fill_buf` 32 bytes on first run, store at
   `/ext/apps_data/tappy/key.bin`, derive the address (keccak of the pubkey) and show it.
4. USB CDC channel (`usb_cdc_dual`, app on channel 1) with a one-line protocol:
   `REQ <json>` -> screen -> OK -> `ecdsa_sign_digest(&secp256k1, key, digest32, sig, &recid, NULL)`
   -> `SIG <r||s||v>`; Back -> `REJ`. Copy the pattern from the firmware's `usb_uart_bridge.c`.
5. Bridge gets a second implementation, `FlipperDeviceSigner`, that holds no key. It satisfies
   the same `HumanSigner` interface, so nothing else in the system changes.
6. Honesty: while the app runs, use `usb_cdc_single` + `cli_vcp_disable()` so the laptop cannot
   inject button presses through the CLI (`input send ok short`). Restore on exit. Note in the
   pitch that the BLE RPC path still exists.

If any step overruns, keep v1 and put the measured timing numbers in the demo instead.
