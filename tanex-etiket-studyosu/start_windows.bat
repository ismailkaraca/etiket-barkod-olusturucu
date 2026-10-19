@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (set "PY=py -3") else (set "PY=python")
%PY% -m pip install -r requirements.txt
if errorlevel 1 (
 echo Kurulum basarisiz. Python 3.11 veya daha yenisi kurulu mu kontrol edin.
 pause
 exit /b 1
)
echo.
echo Uygulama adresi: http://127.0.0.1:8765
start "" "http://127.0.0.1:8765"
%PY% app.py
pause
