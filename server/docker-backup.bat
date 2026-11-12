@echo off
chcp 65001 >nul 2>&1
title Sao Luu He Thong Docker - KSK Portal Gateway
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0docker-backup.ps1" %*
