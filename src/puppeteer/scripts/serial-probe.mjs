// Bare-metal serial probe: same library Puppeteer uses, none of its protocol.
// Usage: node serial-probe.mjs [path] [baud]
import { SerialPort } from "serialport";

const [, , argPath, argBaud] = process.argv;
const baudRate = Number(argBaud ?? 115200);

const stamp = () => new Date().toISOString().slice(11, 23);
const log = (...a) => console.log(stamp(), ...a);

const ports = await SerialPort.list();
console.log("=== ports visible to node-serialport ===");
for (const p of ports)
  console.log(`  ${p.path}  vid=${p.vendorId ?? "-"} pid=${p.productId ?? "-"} ${p.manufacturer ?? ""}`);

// macOS: serialport lists /dev/tty.* (dial-in); /dev/cu.* is the callout
// device you actually want for a USB board.
const found = ports.find((p) => /usbmodem|usbserial/i.test(p.path))?.path;
const path = argPath ?? found?.replace("/dev/tty.", "/dev/cu.");
if (!path) {
  console.error("no usb serial port found");
  process.exit(1);
}
console.log(`\n=== opening ${path} @ ${baudRate} ===`);

const port = new SerialPort({ path, baudRate }, (err) => {
  if (err) {
    console.error("OPEN FAILED:", err.message);
    process.exit(1);
  }
});

let bytes = 0;
port.on("data", (d) => {
  bytes += d.length;
  log("RX", JSON.stringify(d.toString("utf8")));
});
port.on("error", (e) => log("ERROR", e.message));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const set = (opts) =>
  new Promise((r) => port.set(opts, (e) => r(e ? `(${e.message})` : "ok")));

port.once("open", async () => {
  log("open");

  log("listening 2s for unsolicited output (READY only prints at boot)...");
  await wait(2000);

  log(`sending "eye,?" (read-only, moves nothing)`);
  port.write("eye,?\n");
  await wait(1500);

  log("toggling DTR/RTS low->high to try to reset the board...");
  log("  clear:", await set({ dtr: false, rts: false }));
  await wait(250);
  log("  set:  ", await set({ dtr: true, rts: true }));
  log("watching 4s for a boot banner...");
  await wait(4000);

  log(`sending "eye,?" again`);
  port.write("eye,?\n");
  await wait(1500);

  console.log(`\n=== total bytes received: ${bytes} ===`);
  port.close(() => process.exit(0));
});
