# Agent instructions

- Mono is a Tauri 2 desktop app: the page in `src/` (React, Vite, pnpm), the app in
  `src-tauri/`, and `crates/core`, which does a project's file, search, git and terminal work both
  in the app (folders on this computer) and in `crates/agent` (the helper copied into Docker
  containers). New project features go in `crates/core` so both get them.
- `crates/host` has the Docker, SQL and theme repo code the app and `mono-host` share. The terminal
  version is a Neovim plugin in its own repo (`mono-nvim`, usually cloned next to this one) that
  talks to `mono-host`. A feature added to the app's page usually wants its counterpart in its
  `lua/mono`, and a change to `mono-host`'s messages has to keep the plugin working.
- Use pnpm for the page, not npm or Yarn.
- The helper is built for Linux with musl and `rust-lld` (`pnpm agent`); keep it free of
  C dependencies so it cross-compiles from macOS without extra toolchains.
- Closing the window and quitting go through the page (app → `app:quit-requested` → page asks
  about unsaved changes → `quit`), so keep that path working.
- Write comments only where the code can't explain itself.
- Checks: `pnpm build && pnpm lint`, `cargo test --workspace`.
