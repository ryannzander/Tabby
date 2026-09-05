import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { FlipperCli } from "./flipperCli.js";

/** Copies device/flippy-js/flippy.js onto the Flipper's SD card over USB. */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const source = readFileSync(new URL("../../../device/flippy-js/flippy.js", import.meta.url), "utf8");

  const cli = new FlipperCli(cfg.FLIPPER_PORT, cfg.FLIPPER_BAUD);
  await cli.open();
  await cli.mkdir("/ext/apps_data/flippy");
  await cli.writeFile("/ext/apps/Scripts/flippy.js", source);
  await cli.close();

  console.log("Installed. On the Flipper: Apps -> Scripts -> flippy.js");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
