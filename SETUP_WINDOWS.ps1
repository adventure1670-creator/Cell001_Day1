$ErrorActionPreference = 'Stop'
Write-Host 'Cell 001 - Windows setup'
python --version
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest -q tests/test_geometry.py
Write-Host ''
Write-Host 'Local deterministic tests passed. Next: python local_proof.py'
