@echo off
rem Dvoklik za pokretanje igre KAGE (zaobilazi ogranicenje izvrsavanja PowerShell skripti samo za ovo pokretanje)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Pokreni-KAGE.ps1" %*
