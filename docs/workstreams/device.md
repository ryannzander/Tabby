# Workstream C — Device & Bridge

**Owner:** the person with the Flipper (macOS, Momentum firmware). **Reads:** `../SPEC.md` §1, §3.3, §3.4, §3.6, §8 Risk 1.
**Your job in one sentence:** implement `HumanSigner` so that the answer comes from a button press on the Flipper. Everything else in the system treats you as a black box behind the WS protocol in §3.4.

## Deliverables
1. `apps/bridge` — Node process: connects to the app's approval channel, sends `signer.hello`, on `approval.request` talks to the Flipper, on decision signs with the human key (v1) and sends `approval.result`.
2. `device/tappy-js/tappy.js` — the Flipper app (already scaffolded): waits for a request, shows it, returns OK/Back.
3. `docs/spikes.md` entry for Spike 1 (hour 1).
4. Stretch (M6): `device/tappy-c` signer.

## Hour 0–1 — Spike 1: the file channel (do this before writing any code)
Goal: confirm the laptop can write/read files on the SD card via the USB CLI while a JS app is showing a dialog.
1. Connect Flipper via USB. Find the port: `ls /dev/cu.usbmodem*`. Open with `screen /dev/cu.usbmodemflip_XXXX 230400` (or `pnpm dlx serialport-terminal`). Press Enter, you should see the `>:` prompt.
2. On the Flipper, open Apps → Scripts → run any JS example that shows a dialog (e.g. `dialog.js` from the examples folder), leave it on screen.
3. In the terminal: `storage write /ext/apps_data/tappy/inbox.json` then type `{"seq":1}` and Ctrl+C. Then `storage read /ext/apps_data/tappy/inbox.json`.
4. Now write a 10-line JS that loops: `storage.read` the inbox, if present show `dialog.message` with its content. Run it, then write a different file from the laptop. Does the app see it?
Record: works / works only when no dialog is open / CLI unavailable while JS app runs. Also note: does `storage` in Momentum's JS expose `read`/`write`/`exists`/`remove`? (Momentum's JS API is a superset of official; check their `js` docs in the firmware repo you flashed.)

Decision at hour 3, based on the result:
- **Works:** proceed with §3.6 as written.
- **Works only outside dialogs:** app loop = poll inbox every 500 ms → when present, show dialog (blocking) → write outbox → delete inbox → back to polling. Bridge only writes while the app is polling (it can tell: outbox for the previous seq exists).
- **CLI dead while JS app is up:** fallback to a C app owning USB CDC. Use the `usb_uart_bridge.c` pattern from the firmware (`furi_hal_usb_set_config(&usb_cdc_dual)`, keep CLI on channel 0, app on channel 1). Claude writes it; you build with uFBT against Momentum's SDK. This is the same toolchain as M6 so it is not wasted. Tell A and B; nothing changes for them.

## bridge design
```
src/
  index.ts        connect to HUB_WS_URL, send signer.hello {kind:"flipper", address}
  key.ts          human key: HUMAN_KEY in .env (viem privateKeyToAccount). Print address on boot; A needs it for the M3 redeploy.
  flipper.ts      FlipperCli: open serialport 230400; write(path, text); read(path); remove(path); with a 5 s command timeout and prompt detection (">:")
  signer.ts       FlipperHumanSigner implements HumanSigner:
                    requestApproval(view, timeoutMs):
                      seq++; write inbox {..view, seq}; poll read outbox every 300 ms until seq matches or timeout
                      approved → humanSig = account.signTypedData(typed data from packages/protocol) ; return Decision
                      timeout → remove inbox; return {approved:false}
```
Use `packages/protocol`'s `MockHumanSigner` as the reference: same interface, same `Decision` shape, same signing call. Your class is that class with the y/n replaced by the Flipper.

CLI gotchas to expect: the CLI echoes input; strip it. `storage write` ends on Ctrl+C (`\x03`). Chunked writes exist (`storage write_chunk <path> <size>`) if plain `write` mangles JSON. Keep payloads under 200 bytes.

## tappy.js (Momentum JS)
Screen (128×64) layout for `dialog`:
```
 header:  TAPPY  #1a2b…9f0e
 text:    SEND 0.010 ETH
          to 0xAb12…F9e3
          Sepolia
 buttons: [Reject]        [Approve]
```
Loop: `while(true){ if(storage.exists(INBOX)){ req=JSON.parse(read); if(req.seq>lastSeq){ show dialog; write OUTBOX {id,seq,approved,at}; lastSeq=req.seq; storage.remove(INBOX) } } delay(300) }`. Vibrate + LED on new request (`notification` module). Back button on the main loop exits. Add a splash screen (there's room for 1-bit art; it's on camera).
Install: `device/tappy-js/install.sh` copies the script to `/ext/apps/Scripts/tappy.js` via the CLI. Launch from Apps → Scripts. (Momentum may allow `loader open` of a JS script from the CLI; if so, bridge can auto-launch it on boot. Nice, not required.)

## M3 — the real demo
Sequence: `pnpm --filter bridge dev` → prints human address → A redeploys with it → B switches the app to the external signer → the agent proposes → Flipper buzzes → OK → tx. Film it once as soon as it works; that clip is insurance.

## M6 stretch — key on the device (C app)
Only start if M5 is done. Plan, in order:
1. `pip install ufbt`; `ufbt update` against Momentum's SDK (their repo documents the `--index-url`). `ufbt create APPID=tappy`; `ufbt launch` a hello world. Budget: 2 hours. If it's not on the device in 2 hours, stop.
2. Vendor `lib/crypto` from FlipBIP (trezor-crypto subset: `secp256k1`, `ecdsa`, `sha3`, `hasher`, `rand`, `memzero`, `bignum`) as `fap_private_libs` in `application.fam`. Build. This is the RAM-risky step; strip anything not needed for sign.
3. Key: on first run, `furi_hal_random_fill_buf` 32 bytes → save to `/ext/apps_data/tappy/key.bin`; derive address (keccak of pubkey) and show it. Bridge reads the address via a `getaddr` command.
4. USB CDC channel (`usb_cdc_dual`, channel 1), tiny line protocol: `REQ <json>` → screen → OK → `ecdsa_sign_digest(&secp256k1, key, digest32, sig, &recid, NULL)` → `SIG <r||s||v>`; Back → `REJ`.
5. Bridge gets a second `HumanSigner` impl: `FlipperDeviceSigner` (no key on laptop). Measure and log signing time; it's a slide.
6. For the honesty clause: use `usb_cdc_single` + `cli_vcp_disable()` while the app runs so the laptop cannot inject buttons; restore on exit (see `gpio` app's `usb_uart_bridge.c` for the exact calls).

If any step overruns, keep v1 and put the measured numbers from step 2–4 in the video instead.
