import { SerialPort } from "serialport";

/**
 * Talks to the Flipper's USB CLI (virtual COM port).
 *
 * SPIKE 1 (docs/spikes.md) must confirm these commands still work while a JS app is in the
 * foreground. If they do not, the fallbacks are, in order:
 *   a) the JS app polls instead of blocking in a dialog,
 *   b) speak the RPC protobuf protocol instead of the text CLI,
 *   c) a C app that owns USB CDC (see device/tappy-c/README.md).
 */
export class FlipperCli {
  private port: SerialPort | null = null;
  private buffer = "";
  private waiters: { match: RegExp; resolve: (s: string) => void; reject: (e: Error) => void }[] = [];

  constructor(
    private readonly path: string,
    private readonly baudRate: number,
  ) {}

  async open(): Promise<void> {
    this.port = new SerialPort({ path: this.path, baudRate: this.baudRate });
    this.port.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      this.drain();
    });
    await new Promise<void>((resolve, reject) => {
      this.port!.once("open", () => resolve());
      this.port!.once("error", reject);
    });
    // Wake the CLI and swallow the banner.
    await this.command("", 2000).catch(() => undefined);
  }

  async close(): Promise<void> {
    await new Promise<void>((r) => (this.port ? this.port.close(() => r()) : r()));
    this.port = null;
  }

  private drain(): void {
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i]!;
      const m = this.buffer.match(w.match);
      if (m) {
        const out = this.buffer.slice(0, m.index);
        this.buffer = this.buffer.slice((m.index ?? 0) + m[0].length);
        this.waiters.splice(i, 1);
        w.resolve(out);
      }
    }
  }

  /** Sends a line and resolves with everything printed before the next `>:` prompt. */
  private command(line: string, timeoutMs = 5000): Promise<string> {
    if (!this.port) throw new Error("FlipperCli: port is not open");
    this.port.write(line + "\r\n");
    return new Promise((resolve, reject) => {
      const waiter = { match: />:\s*$/m, resolve, reject };
      this.waiters.push(waiter);
      setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`Flipper CLI timeout after ${timeoutMs}ms: ${line}`));
        }
      }, timeoutMs);
    });
  }

  /** `storage write` streams until Ctrl-C, so the payload is sent then terminated with \x03. */
  async writeFile(path: string, contents: string): Promise<void> {
    if (!this.port) throw new Error("FlipperCli: port is not open");
    this.port.write(`storage write ${path}\r\n`);
    await new Promise((r) => setTimeout(r, 150)); // let the device open the file
    this.port.write(contents + "\r\n\x03");
    await this.command("", 5000);
  }

  async readFile(path: string): Promise<string | null> {
    const out = await this.command(`storage read ${path}`);
    if (/Storage error|does not exist|not found/i.test(out)) return null;
    // The device echoes "Size: N" then the bytes; take everything after the first blank line.
    const idx = out.indexOf("\n\n");
    const body = (idx >= 0 ? out.slice(idx + 2) : out).trim();
    return body.length ? body : null;
  }

  async remove(path: string): Promise<void> {
    await this.command(`storage remove ${path}`).catch(() => undefined);
  }

  async mkdir(path: string): Promise<void> {
    await this.command(`storage mkdir ${path}`).catch(() => undefined);
  }
}
