# Contributing to Atlas Commerce

Thank you for your interest in contributing to **Atlas Commerce**! We welcome bug reports, feature requests, documentation improvements, and code contributions.

Atlas Commerce is an enterprise commerce, inventory, invoicing, and POS suite designed for sovereign, self-hosted deployment.

---

## 1. Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for everyone.
- Treat fellow contributors with respect and professional courtesy.
- Focus on constructive feedback.
- Help foster an environment that encourages quality, security, and accessibility.

---

## 2. Licensing

Atlas Commerce is available under either the [MIT License](./LICENSE) or the [Apache License, Version 2.0](./LICENSE-APACHE), at the recipient’s option. Unless you state otherwise, contributions intentionally submitted for inclusion are offered under both licenses. Only submit work you have the right to contribute, and retain applicable third-party notices.

---

## 3. How Can I Contribute?

### Reporting Bugs
1. **Check existing issues** to avoid filing duplicates.
2. If the bug is a **security vulnerability**, please review [SECURITY.md](./SECURITY.md) and report it responsibly via private channels.
3. For regular bugs, open an issue including:
   - Clear description of the unexpected behavior.
   - Steps to reproduce.
   - Expected vs. actual result.
   - Environment details (Node.js version, browser/Android client version, deployment mode).

### Suggesting Enhancements
- Clearly describe the proposed feature and its use case.
- Explain why this feature is valuable for self-hosted commerce or inventory workflows.

### Submitting Pull Requests
1. Fork the repository and create your branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Keep your PR focused on a single change.
3. Adhere to repository coding conventions:
   - TypeScript for frontend and Cloudflare Worker.
   - React 18 + Vite for the web interface.
   - Cloudflare Workers + D1 SQLite + R2 for backend infrastructure.
4. Run tests and linting locally:
   ```bash
   npm test
   ```
5. Ensure all existing regression suites continue to pass.
6. Submit a Pull Request targeting `main` with a clear explanation of your changes.

---

## 4. Security & Role Policy Guidelines

When developing backend mutations or routes:
- **Server-Side Enforcement**: Never rely solely on client-side role checks. Always validate actors against authoritative database records (`app_users`).
- **Role Isolation**: Product master catalog writes are strictly owner/admin; non-admin roles submit requests or stock movement proposals.
- **Self-Hosting Compatibility**: Avoid hardcoding fixed external cloud domains or certificate pins that would break custom tenant hostnames.
- **Field Minimization**: Ensure internal financial calculations, supplier costs, and sensitive client information are masked for unprivileged roles (`stock`, `user`).

---

## 5. Development Setup

Follow [SETUP.md](./SETUP.md) for full instructions on setting up local Node.js dependencies, Cloudflare Wrangler configuration, and in-memory test databases.
