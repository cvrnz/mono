# Agent instructions

- Mono is a Tauri 2 desktop app: the page in `src/` (React, Vite, Bun), the app in
  `src-tauri/`, and `crates/core`, which does a project's file, search, git and terminal work both
  in the app (folders on this computer) and in `crates/agent` (the helper copied into Docker
  containers). New project features go in `crates/core` so both get them.
- Use Bun for the page, not Node or npm.
- The helper is built for Linux with musl and `rust-lld` (`bun run agent`); keep it free of
  C dependencies so it cross-compiles from macOS without extra toolchains.
- Closing the window and quitting go through the page (app → `app:quit-requested` → page asks
  about unsaved changes → `quit`), so keep that path working.
- Write comments only where the code can't explain itself.
- Checks: `bun run build && bun run lint`, `cargo test --workspace`.
