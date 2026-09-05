import WebSocket from "ws";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  MockHumanSigner,
  approvalRequestSchema,
  chainByKey,
  hubToSignerSchema,
  type Decision,
  type HumanSigner,
} from "@tappy/protocol";
import { loadConfig } from "./config.js";
import { FlipperCli } from "./flipperCli.js";
import { FlipperHumanSigner } from "./flipperSigner.js";

const RECONNECT_MS = 2000;

async function buildSigner(cfg: ReturnType<typeof loadConfig>): Promise<HumanSigner> {
  const chain = chainByKey(cfg.CHAIN_KEY);
  const common = {
    privateKey: cfg.HUMAN_KEY as Hex,
    chainId: chain.chainId,
    gate: cfg.GATE_ADDRESS as Address,
  };

  if (cfg.SIGNER_KIND === "mock") {
    console.log("[bridge] SIGNER_KIND=mock — approving from this terminal, no hardware used");
    return new MockHumanSigner({ ...common, mode: "cli" });
  }

  const cli = new FlipperCli(cfg.FLIPPER_PORT, cfg.FLIPPER_BAUD);
  await cli.open();
  await cli.mkdir("/ext/apps_data/tappy");
  console.log(`[bridge] Flipper connected on ${cfg.FLIPPER_PORT}`);
  return new FlipperHumanSigner({ ...common, cli });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const account = privateKeyToAccount(cfg.HUMAN_KEY as Hex);
  console.log(`[bridge] human address ${account.address}`);
  console.log("[bridge] the gate must be deployed with this address as `human`");

  const signer = await buildSigner(cfg);
  connect(cfg.HUB_WS_URL, cfg.SIGNER_KIND, signer, account.address);
}

function connect(url: string, kind: "flipper" | "mock", signer: HumanSigner, address: Address): void {
  const ws = new WebSocket(url);

  ws.on("open", () => {
    console.log(`[bridge] connected to hub at ${url}`);
    ws.send(JSON.stringify({ t: "signer.hello", address, kind: kind === "mock" ? "mock" : "flipper" }));
  });

  ws.on("message", async (raw) => {
    const parsed = hubToSignerSchema.safeParse(JSON.parse(raw.toString()));
    if (!parsed.success) return console.warn("[bridge] ignoring unparseable message");

    if (parsed.data.t === "approval.cancel") {
      console.log(`[bridge] hub cancelled ${parsed.data.id}`);
      return;
    }

    const { view, timeoutMs } = approvalRequestSchema.parse(parsed.data);
    console.log(`[bridge] approval requested: ${view.action} ${view.amount} -> ${view.counterparty}`);
    let decision: Decision;
    try {
      decision = await signer.requestApproval(view, timeoutMs);
    } catch (err) {
      console.error("[bridge] signer failed:", err);
      decision = { id: view.id, approved: false, signer: address, at: Date.now() };
    }
    console.log(`[bridge] -> ${decision.approved ? "APPROVED" : "REJECTED"}`);
    ws.send(JSON.stringify({ t: "approval.result", decision }));
  });

  ws.on("close", () => {
    console.log(`[bridge] hub disconnected, retrying in ${RECONNECT_MS}ms`);
    setTimeout(() => connect(url, kind, signer, address), RECONNECT_MS);
  });

  ws.on("error", (err) => console.error("[bridge] socket error:", err.message));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
