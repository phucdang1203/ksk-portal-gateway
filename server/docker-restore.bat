@echo off
chcp 65001 >nul 2>&1
title Khoi Phuc Va Chay He Thong Docker - KSK Portal Gateway
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0docker-restore.ps1" %*
