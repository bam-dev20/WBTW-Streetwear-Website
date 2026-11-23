@echo off
setlocal
echo Installing WBTW website dependencies...
call npm.cmd install
if errorlevel 1 goto install_failed
call npm.cmd rebuild better-sqlite3 sqlite3
if errorlevel 1 goto rebuild_failed
echo.
echo Installation complete! Starting the server...
call npm.cmd start
pause
exit /b

:install_failed
echo.
echo Dependency installation failed. Check the error above and try again.
pause
exit /b 1

:rebuild_failed
echo.
echo The better-sqlite3 native module could not be rebuilt. Check the error above.
pause
exit /b 1