#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
python3 -m pip install -r requirements.txt
printf '\nTarayicida acin: http://127.0.0.1:8765\n'
python3 app.py
