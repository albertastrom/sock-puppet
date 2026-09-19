"""Connect two real POSIX pseudo terminals, exercising native serialport bindings.
No physical hardware or socat required. Runs on macOS/Linux; Python 3 required.
"""
import errno
import os
from pathlib import Path
import pty
import select
import subprocess
import time
import tty

root = Path(__file__).resolve().parent.parent


def find_bin(name: str, start: Path) -> str:
    for directory in [start, *start.parents]:
        candidate = directory / "node_modules" / ".bin" / name
        if candidate.exists():
            return str(candidate)
    raise RuntimeError(f"{name} not found in node_modules/.bin")


masters, slaves, children = [], [], []
try:
    for _ in range(2):
        master, slave = pty.openpty()
        tty.setraw(slave)
        os.set_blocking(master, False)
        masters.append(master)
        slaves.append(slave)
    paths = [os.ttyname(slave) for slave in slaves]
    tsx = find_bin("tsx", root)
    emulator = subprocess.Popen([tsx, 'scripts/emulator.ts', paths[0], '115200'], cwd=root, stdout=subprocess.PIPE, text=True)
    children.append(emulator)
    if not select.select([emulator.stdout], [], [], 5)[0]:
        raise RuntimeError('Emulator did not open its serial port')
    ready = emulator.stdout.readline()
    if 'Robot emulator on' not in ready:
        raise RuntimeError('Emulator failed before opening its serial port')
    print(ready.strip())
    client = subprocess.Popen([tsx, 'scripts/pty-client.ts', paths[1], '115200'], cwd=root)
    children.append(client)
    deadline = time.monotonic() + 25
    outbound = {master: bytearray() for master in masters}
    while client.poll() is None and time.monotonic() < deadline:
        readable, writable, _ = select.select(masters, [m for m in masters if outbound[m]], [], 0.05)
        for source in readable:
            try:
                data = os.read(source, 4096)
                target = masters[1 - masters.index(source)]
                outbound[target].extend(data)
                if len(outbound[target]) > 1024 * 1024:
                    raise RuntimeError('PTY bridge backpressure limit exceeded')
            except OSError as error:
                if error.errno not in (errno.EIO, errno.EAGAIN):
                    raise
        for target in writable:
            try:
                # Deliberately fragment frames across reads/writes without blocking.
                count = os.write(target, outbound[target][:37])
                del outbound[target][:count]
            except OSError as error:
                if error.errno not in (errno.EIO, errno.EAGAIN):
                    raise
    if client.poll() is None:
        raise RuntimeError('PTY smoke timed out')
    if client.returncode:
        raise SystemExit(client.returncode)
finally:
    for child in children:
        if child.poll() is None:
            child.terminate()
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
    for fd in masters + slaves:
        os.close(fd)
