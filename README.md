# Monomyth

Monomyth is a desktop editor for folders on your computer and inside the Docker containers
running on it. It's built with Tauri: a Rust backend and a React page (Monaco with Vim
keybindings, xterm.js terminals) in the system's web view. It has an explorer, source control,
fuzzy file and text search, terminals, a command palette, themes, and SQL tabs for querying
databases.

## Using it

- **This computer**: press **Connect** to work in your home folder, or type another folder's
  path first. Terminals run your login shell; source control uses the `git` you have installed.
- **A Docker container**: pick a running container from the list (Compose containers show their
  project and service), optionally a folder (the default is the container's working
  directory), and press **Connect**. Monomyth copies a small helper program into the container
  (`/tmp/monomyth-agent-*`) and runs it with `docker exec`; it reads and writes files, searches,
  runs shells and git there. It works with Docker Desktop, OrbStack and Colima, on amd64 and
  arm64 containers. Terminals need a shell in the container and source control needs `git`.

Recent folders and containers are listed at the top.

Once connected, `ChangeDirectory` (or `cd path`) moves the project to another folder: on this
computer it opens a folder picker, in a container it asks for a path (relative paths start from
the current folder). New terminals open there, the Explorer shows it, and the Git tab looks for
repos under it.

Shortcuts use Cmd on macOS and Ctrl elsewhere:

| Shortcut | Action |
|----------|--------|
| W | Close the tab or split (asks about unsaved changes; the Explorer and Git tabs stay, and closing the last other tab leaves a welcome screen) |
| S | Save (asks for a path for a new file) |
| N | New tab |
| P | Command palette |
| F | Search file names; Tab switches to searching text |
| G | Git (source control); again to go back to the tab you were on |
| E | File explorer; again to go back to the tab you were on |
| T | Terminal in a new tab |
| D | SQL (database) in a new tab |
| \\ | Terminal split below |
| Shift+\\ | Terminal split to the right |
| H / L | Previous / next tab |
| J / K | Next / previous pane: the parts of Explorer, Git and SQL (sidebar, editor, results), then splits |
| 1 … 9 | Switch to the first … ninth project |

Several projects (folders or containers) can be open in one window, each with its own
connection, tabs and terminals. They're listed left of the tabs: `+` (or the `NewProject`
command) opens another on the connect screen, a middle click or `Disconnect` closes one, and
Cmd+1, Cmd+2, ... switch between them.

Monomyth opens where you left off: the projects that were open reconnect, and their tabs come
back once connected (files at the same cursor, terminals, source control, the explorer, SQL
tabs with their query and connection, splits, the current tab and project). Unsaved changes and untitled files aren't kept, and terminals start new
shells. If a project can't reconnect, its connect screen shows why, and its tabs come back
when you connect it to the same place. This is saved as `session` in the settings file.

The Explorer, Git and SQL tabs show a line of hints at the bottom: the keys for the part that
has the focus (the sidebar, the query, the results, ...) and how to move to the next part.
Their sidebars can be resized by dragging the line beside them (double-click it for the default
width); the widths are kept as `sideWidths` in the settings file.

Shortcuts work everywhere, Vim's insert mode and terminals included. Esc closes search and the command
palette wherever the focus is. Selecting text in a terminal copies it.

In a terminal, Esc Esc switches to normal mode, as in nvim (a single Esc still goes to the
shell): `h`/`j`/`k`/`l`, `w`/`b`/`e`, `0`/`^`/`$`, `gg`/`G`, `H`/`M`/`L` and Ctrl+U/D/B/F/E/Y
move through the output and scrollback, `v`/`V` select, `y` copies (`yy` the line), `/` and
`?` search (`n`/`N` repeat). `i`, `a` or Enter goes back to
the shell.

The command palette runs the app's commands (`Themes`, `ToggleLineNumbers`, `ToggleVim`,
`FontSize 15`, `MaxColumns 100`, `ChangeDirectory`, `GitDepth 6`, `Reconnect`, `NewProject`, `Disconnect`, ...) and, in a file with Vim
keybindings, any Ex command (`w`, `e path`, `%s/a/b/g`, `10`, `sort`; `:` in the file opens Vim's own
prompt for those too). Tab completes the highlighted command.

Every project's first two tabs are Explorer and Git, which can't be closed; the tabs you open
come after them.

- **Explorer** (Cmd+E, again to go back): the folder's tree and a preview of the selected
  file, showing the file that was open. `j`/`k` move, `l`/Enter open or expand, `h` collapse,
  `a` new file (end with `/` for a folder), `r` rename or move, `d` delete, `y` copy the path,
  `R` refresh. Files open in a tab of their own. Files with uncommitted changes show in their Git
  status's color and letter (`M` modified, `U` untracked, `A` added, `R` renamed), and folders
  holding any with a dot.
- **SQL** (Cmd+D, the `Sql` command, or `Sql <saved connection>`): a tab connected to a PostgreSQL,
  MySQL/MariaDB, SQL Server or SQLite database. Queries run from this computer (not in the
  container). The left lists the saved connections
  (`a` new, `e` edit, `d` delete, Enter connect); connected, it lists the tables and views (by
  schema when there are several) and their columns: `l`/`h` expand and collapse, Enter shows a
  table's first 100 rows, `i` inserts the name in the query, `y` copies it, `R` refreshes.
  Cmd+Enter (Ctrl+Enter) in the editor runs the selection, or all of it; several statements
  give several results. Each result is a table (up to 10,000 rows): `h`/`j`/`k`/`l` move, `y`
  or Cmd+C copies the cell, `Y` the row. Messages shows rows affected, notices and errors
  (PostgreSQL's mark where in the query). Cancel stops a running query. SQLite takes a file
  path (`~/...` works, or `:memory:`); SQL Server signs in with a SQL Server login. Connections, passwords included, are saved as
  `sqlConnections` in the settings file.
- **Git** (Cmd+G, again to go back): Repos and Changes lists (Tab switches), a side-by-side diff of
  the selected file, and a sync button that pulls, pushes or publishes the branch. Enter on a
  file opens it. Repos are found up to 4 folders below the project's folder (skipping hidden
  folders and `node_modules`) and listed as a tree; `GitDepth 6` looks deeper.
- **Welcome**: Tab shows another piece of art; `i`, `a` or `o` starts a new file.

Settings (theme, Vim on/off, line numbers, font, centered width, the path to `docker`, recent
connections) are saved in `settings.json` in the app's config folder
(`~/Library/Application Support/dev.monomyth.app` on macOS, `~/.config/dev.monomyth.app` on Linux).

Your own themes go in a `themes` folder there, one JSON file each, and are listed first in
`Themes` (which re-reads the folder each time it opens). The name is the file's unless the
file gives a `name`; one with a built-in theme's name replaces it. Every color is `#rrggbb`:

```json
{
  "name": "darq",
  "bg": "#151515",        "dark": "#1e1e1e",   "raised": "#252525", "selection": "#1e334f",
  "fg": "#f1f2f4",        "dim": "#8f9299",
  "red": "#e94646",       "green": "#11c965",  "yellow": "#f7b750", "orange": "#f7b750",
  "blue": "#6da6f5",      "purple": "#b699eb", "cyan": "#71d0d5"
}
```

`bg` is the background, `dark` floating windows and popups, `raised` the cursor line and
selected tab, `selection` selected text, `fg` text, `dim` comments and muted text; the rest
color code (`orange` numbers and constants, `purple` keywords, `blue` functions, `green`
strings, `cyan` types). The folder can be a link to one kept elsewhere, like a dotfiles repo.

Themes can also come from GitHub, the way Neovim plugin managers fetch them. `themeRepos` in
the settings lists them as `owner/repo`; each is cloned into the themes folder the first time
the app starts with it, and the JSON files at the top of the repo become themes. The list
starts with `cvrnz/monomyth-dark-theme`, which holds the default theme, `monomyth-dark`
(until it's downloaded, or without a connection, `onedark` is used instead).

- `AddTheme owner/repo` downloads a theme repo and adds it to the list (a full git URL works too).
- `RemoveTheme owner/repo` deletes it and takes it off the list.
- `UpdateThemes` pulls the latest version of every theme repo.

If the connection drops, the app reconnects once by itself and otherwise shows a Reconnect
button; open files and unsaved changes stay, and terminals start a new shell when typed in.

## Building

Needs Bun and Rust (rustup). The container helper is cross-compiled for Linux
(`aarch64-unknown-linux-musl` and `x86_64-unknown-linux-musl`, linked with `rust-lld`, which
comes with Rust); `bun run agent` adds the targets if they're missing.

```sh
bun install
bun run app      # run in development
bun run bundle   # build Monomyth.app and a .dmg into target/release/bundle
```

The app finds `docker`, `git` and your shell's tools through your login shell's PATH, so it
works when opened from Finder or the Dock. The build isn't signed: the first time, right-click
the app and choose Open.

Checks:

```sh
bun run build && bun run lint
cargo test --workspace
```

Some tests need running services and are skipped without them:
`MONOMYTH_TEST_CONTAINER=<a running container>` tests the Docker connection, and
`MONOMYTH_TEST_PG_PORT` / `MONOMYTH_TEST_MYSQL_PORT` test Postgres (user `postgres`) and MySQL
(user `root`, database `t`) with the password `pw`.

## Layout

- `src/` — the page: React, Monaco (with monaco-vim) and xterm.js, built by Vite.
  `components/` has the screens and panes (connect screen, tabs, editor, terminals, Git,
  Explorer, SQL); `lib/` the rest: calls to the backend (`bridge.ts`, `agent.ts`), app
  state, actions, commands, shortcuts, Vim, themes, the saved session and the window.
- `src-tauri/` — the app: Tauri commands and the menu and quit handling (`src/main.rs`),
  Docker containers and the helper's connection (`src/docker.rs`), and the SQL tabs' databases
  (`src/sql`: tokio-postgres, mysql_async, tiberius and rusqlite).
- `crates/core` — what a project does with files, search (ripgrep's libraries), git and
  terminals (portable-pty), called by method name with JSON. The app runs it in-process for
  folders on this computer; the helper runs it inside containers.
- `crates/agent` — the container helper: `crates/core` over stdin/stdout, one JSON message
  per line. `scripts/build-agent.sh` builds it into `src-tauri/resources/agent`, which the app
  bundles.
