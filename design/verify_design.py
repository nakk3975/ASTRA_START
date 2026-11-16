#!/usr/bin/env python3
"""Run all bundled design calculations. No game server is started or deployed."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
steps = [
    'validate_balance.py',
    'analyze_balance.py',
    'simulate_factory_schedule.py',
    'analyze_automation.py',
    'validate_map_v1.py',
]
for step in steps:
    print('\nRUN ' + step, flush=True)
    result = subprocess.run([sys.executable, str(root / step)], cwd=root)
    if result.returncode:
        raise SystemExit(result.returncode)
print('\nDESIGN CHECKS PASSED. Runtime, multiplayer and playtest acceptance remains pending.')
