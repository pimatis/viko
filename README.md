# Viko

Viko is a desktop-first video editor built with SvelteKit. Import media from your device, edit on a frame-precise multi-track timeline with keyframes, color grading, chroma key, captions and effects, then export MP4 completely offline. Projects, media and version snapshots are stored locally in IndexedDB — your footage never leaves your machine.

## Download

```bash
git clone https://github.com/pimatis/viko.git
cd viko
```

## Install

```bash
bun install

# npm install
# pnpm install
# yarn install
```

## Development

```bash
bun run dev        # start the dev server on port 8080
bun run build      # production build
bun run preview    # preview the production build
bun run check      # type-check with svelte-check
bun run lint       # prettier check + eslint
bun run format     # auto-format the codebase
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code conventions and the pull request process.

## License

Viko is licensed under the [Apache License 2.0](LICENSE).
