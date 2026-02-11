@echo off
echo Generating SSL certificates with mkcert...
echo.

mkcert -install

mkcert -key-file localhost-key.pem -cert-file localhost-cert.pem localhost 127.0.0.1 ::1

echo.
echo ✓ Certificates generated successfully!
echo   - localhost-cert.pem
echo   - localhost-key.pem
echo.
echo You can now start the backend with ENABLE_HTTPS=true
