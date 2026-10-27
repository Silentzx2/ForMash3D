# Security Policy — ForMesh3D

ForMesh3D is designed for local, self-hosted use. The default development configuration does not enable user authentication or API-key protection, so bind the backend to localhost and place a firewall or authenticated reverse proxy in front of any remote deployment.

## Runtime boundaries

- Keep `:7842` and `:3000` private unless remote access is deliberately configured.
- Treat uploaded images, meshes, model checkpoints, third-party source, and generated assets as untrusted inputs.
- Use the canonical file/path resolvers at upload, artifact, and download boundaries; do not add direct filesystem joins for client-controlled paths.
- Do not commit credentials, model weights, tokens, private URLs, or generated secrets.
- Review third-party model code and licenses before enabling an adapter.

## Authentication and rate limiting

Personal deployments default to simple mode and disable the application rate limiter. Optional user authentication, API keys, and rate limiting are configured in `backend/config/system.yaml` and environment variables. Remote deployments should add perimeter authentication and proxy-level limits.

## Reporting

Do not publish sensitive vulnerability details in a public issue before the maintainer has had an opportunity to address them. See the root `SECURITY.md` for the project contact and supported-version policy.
