"""Reads easypap's stdout and prints "<iterations done> <milliseconds>".

easypap prints "Computation completed after N iterations" followed by the
elapsed time in milliseconds on the next line.
"""
import re
import sys

text = sys.stdin.read()
found = re.search(r"Computation completed after (\d+) iterations\s*\n\s*([\d.]+)", text)
if not found:
    sys.stderr.write(text)
    sys.exit(1)
print(found.group(1), found.group(2))
