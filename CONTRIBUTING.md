# Contributing to Viko

Thanks for your interest in contributing! Viko is an open source project, and every contribution — bug reports, documentation, UI polish or new features — is appreciated.

Please take a moment to read this guide before opening an issue or pull request.

## Getting Started

### 1. Fork and clone

```bash
git clone https://github.com/pimatis/viko.git
cd viko

# # Fork the repository on GitHub first if you plan to open a pull request,
# # then clone your fork and add the upstream remote:
# git remote add upstream https://github.com/pimatis/viko.git
```

### 2. Install dependencies

```bash
bun install

# npm install
# pnpm install
# yarn install
```

### 3. Run the dev server

```bash
bun run dev    # http://localhost:8080 — the editor lives at /editor
```

## Development Commands

```bash
bun run dev        # start the dev server on port 8080
bun run build      # production build
bun run preview    # preview the production build
bun run check      # type-check with svelte-check
bun run lint       # prettier check + eslint
bun run format     # auto-format the codebase
```

Run `bun run check` and `bun run lint` before submitting a pull request.

## Reporting Issues

When opening an issue, please include:

- A clear, descriptive title and step-by-step reproduction
- What you expected to happen vs. what actually happened
- Browser and OS versions (Viko is desktop-first)
- Any console errors or screenshots

## Pull Request Process

1. Create a branch from `main` with a descriptive name: `fix/trim-handle-snap`, `feat/export-gif`, etc.
2. Keep changes focused — one logical change per pull request.
3. Run `bun run check` and `bun run lint` and make sure they pass.
4. Add a short description explaining what the change does and why.
5. Reference any related issue in the description.

## License

By contributing, you agree that your contributions are licensed under the same [Apache License 2.0](LICENSE) that covers the project.
