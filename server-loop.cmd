@echo off
rem Spusti server a po pade ho o 5 s spusti znova. Vystup ide do data\server.log.
cd /d "%~dp0"
if not exist data mkdir data
:loop
echo [%date% %time%] Start servera>> data\server.log
"C:\Program Files\nodejs\node.exe" server.js >> data\server.log 2>&1
ping -n 6 127.0.0.1 >nul
goto loop
