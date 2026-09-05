import { z } from "zod";

const schema = z.object({
  HUMAN_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "HUMAN_KEY must be a 32-byte hex key"),
  HUB_WS_URL: z.string().url().default("ws://localhost:3000/ws"),
  FLIPPER_PORT: z.string().default("/dev/cu.usbmodemflip_Tappy1"),
  FLIPPER_BAUD: z.coerce.number().default(230400),
  SIGNER_KIND: z.enum(["flipper", "mock"]).default("flipper"),
  CHAIN_KEY: z.enum(["sepolia", "arc", "hedera"]).default("sepolia"),
  GATE_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Bad bridge config. Copy .env.example to .env and fill it in:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
