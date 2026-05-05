# Security Notes

## Known Issues

### Moderate — @hono/node-server in Prisma internals
- Affects: Prisma dev tooling only (not production API)
- Impact: None — we use Express, not Hono
- Fix: Wait for Prisma to release patched version
- Date noted: May 2026
- Reference: GHSA-92pp-h63x-v22m

## Security measures in place
- Rate limiting on all routes
- Input validation on all endpoints
- Password reset tokens hashed with bcrypt
- JWT denylist on logout
- Account lockout after 5 failed attempts
- Helmet.js security headers
- No sensitive data in logs
