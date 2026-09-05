// Flippy the Dolphin — approval app for Flipper Zero (Momentum JS engine).
//
// This app is the physical gate. The laptop bridge writes a request to inbox.json;
// this shows it and writes the human's decision to outbox.json. No key material here in v1.
//
// Install:  pnpm --filter @flippy/bridge flipper:install
// Run:      Apps -> Scripts -> flippy.js

let storage = require("storage");
let dialog = require("dialog");
let notify = require("notification");

let DIR = "/ext/apps_data/flippy";
let INBOX = DIR + "/inbox.json";
let OUTBOX = DIR + "/outbox.json";
let POLL_MS = 300;

let lastSeq = 0;

function readJson(path) {
  if (!storage.exists(path)) return undefined;
  let raw = storage.read(path);
  if (!raw) return undefined;
  // mJS has no exceptions, so a malformed file must not wedge the loop.
  let parsed = JSON.parse(raw);
  return parsed;
}

function screenFor(req) {
  // 128x64: four short lines is the whole budget.
  return (
    req.action + " " + req.amount + "\n" +
    "to " + req.counterparty + "\n" +
    req.chain + "  " + req.short
  );
}

function announce() {
  notify.blink("blue", "short");
  notify.success();
}

function respond(req, approved) {
  storage.write(
    OUTBOX,
    JSON.stringify({ id: req.id, seq: req.seq, approved: approved, at: Date.now() })
  );
  if (approved) notify.success();
  else notify.error();
}

print("Flippy: waiting for approval requests...");

while (true) {
  let req = readJson(INBOX);

  if (req !== undefined && req.seq !== undefined && req.seq > lastSeq) {
    lastSeq = req.seq;
    announce();

    let approved = dialog.custom({
      header: "FLIPPY  " + req.short,
      text: screenFor(req),
      button_left: "Reject",
      button_right: "Approve",
    });

    respond(req, approved === "Approve");
    storage.remove(INBOX);
    print("Flippy: " + (approved === "Approve" ? "approved" : "rejected") + " #" + req.seq);
  }

  delay(POLL_MS);
}
