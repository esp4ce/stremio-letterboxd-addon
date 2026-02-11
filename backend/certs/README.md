# SSL Certificates

This directory contains SSL certificates for local HTTPS development.

## Generating Certificates

### Windows
```bash
cd certs
generate.bat
```

### Linux/Mac
```bash
cd certs
chmod +x generate.sh
./generate.sh
```

## Files

- `localhost-cert.pem` - SSL certificate
- `localhost-key.pem` - Private key

These files are generated locally with [mkcert](https://github.com/FiloSottile/mkcert) and are **not committed to git**.

## Usage

Set `ENABLE_HTTPS=true` in your `.env` file to use HTTPS in development.
