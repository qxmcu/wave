# Security

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/qxmcu/wave/security/advisories/new)
rather than public issues.

Things worth knowing:

- The backend listens on `127.0.0.1` only.
- Google cookies and Spotify tokens are stored in `<userData>/wave/accounts.json`,
  encrypted with Electron `safeStorage` when the OS provides it.
