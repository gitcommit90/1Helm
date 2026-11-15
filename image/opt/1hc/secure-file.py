#!/usr/bin/env python3
"""Stream one regular workspace file without following a path component symlink.

stdout is an ASCII size line followed by exactly that many file bytes. The
controller reads the line before reserving storage, then streams the same open
file descriptor into R2. A rename after open cannot change the bytes' source.
"""
import os
import stat
import sys


def main():
    path, limit, expected = sys.argv[1:4]
    root = sys.argv[4] if len(sys.argv) > 4 else "/workspace"
    parts = path.split("/")
    if not parts or any(part in ("", ".", "..") for part in parts) or path.startswith("/"):
        raise ValueError("bad path")
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for index, part in enumerate(parts):
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if index < len(parts) - 1:
                flags |= os.O_DIRECTORY
            next_fd = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > int(limit) or (int(expected) >= 0 and info.st_size != int(expected)):
            raise ValueError("file changed or exceeds limit")
        sys.stdout.buffer.write(f"{info.st_size}\n".encode("ascii"))
        sys.stdout.buffer.flush()
        remaining = info.st_size
        while remaining:
            chunk = os.read(fd, min(65536, remaining))
            if not chunk:
                raise OSError("file shortened during copy")
            sys.stdout.buffer.write(chunk)
            remaining -= len(chunk)
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, IndexError) as error:
        print(f"secure-file: {error}", file=sys.stderr)
        sys.exit(1)
