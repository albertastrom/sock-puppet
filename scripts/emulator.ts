import { SerialPort } from "serialport";
import { attachEmulator } from "../src/robot/emulator";
const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run emulator -- /path/to/serial-or-pty [baud]");
  process.exit(1);
}
const port = new SerialPort({
  path,
  baudRate: Number(process.argv[3] ?? 921600),
});
attachEmulator(
  port,
  undefined,
  Math.max(1200, Math.ceil((60000 * 10000) / port.baudRate) + 500),
);
port.on("open", () => console.log(`Robot emulator on ${path}`));
port.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
