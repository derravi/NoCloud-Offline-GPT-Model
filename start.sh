#!/usr/bin/env bash
# Convenience launcher for Local ChatGPT.
# Creates a virtual environment on first run, installs dependencies,
# then starts the FastAPI server.

set -e
cd "$(dirname "$0")/backend"

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q -r requirements.txt

echo ""
echo "Starting server at http://localhost:8000"
echo "Press Ctrl+C to stop."
echo ""
uvicorn main:app --host 0.0.0.0 --port 8000
