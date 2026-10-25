# Security Policy — ForMesh3D (Root)

## Supported Versions

| Version | Supported |
|---------|-----------|
| main (0.1.0-beta) | :white_check_mark: |
| Older commits / forks | :x: |

## Reporting a Vulnerability

ForMesh3D is a self-hosted, personal-use project. There is no paid SaaS, no
public-facing service, and no bug bounty program.

If you discover a security issue, please open a GitHub issue or contact the
repository maintainer directly. Do not disclose the issue publicly until it
has been addressed.

For local security best practices:

* Keep your NVIDIA drivers and CUDA toolkit up to date.
* Review model weights and third-party code before running inference.
* Do not expose the backend API (`:7842`) or frontend (`:3000`) to the public
  internet without a firewall and authentication.
* The backend API does not enforce user authentication by default (auth is
  disabled for personal use). Bind to `127.0.0.1` only unless you explicitly
  configure remote access.

See `Docs/SECURITY.md` for the full security policy.
