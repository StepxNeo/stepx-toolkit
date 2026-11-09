# Security

Do not post Cookie, token, phone number, SMS code, identity documents, raw response bodies or credential files in public Issues/PRs. Redact screenshots and logs. If a credential leaks, revoke the official session immediately; deleting a Git commit is not sufficient.

This software is intended for one trusted user on loopback only. Local files are permission-restricted, not encrypted. Do not expose the HTTP service to the internet or change its host checks to bypass errors. An OS administrator or process running as the same user can access local credentials.

If you find a security flaw, do not include a working credential or personal information in a public report. Contact the repository owner's private security reporting channel after the repository is published, or use GitHub's private vulnerability reporting if enabled. No contact address is invented in this template.

Reports should include version, operating system, a synthetic reproduction, expected behavior and impact. No real SMS traffic is necessary for a report. Do not perform unauthorized account tests.
