# My Herdr Theme & Mods

[English](README.md) | [繁體中文](README.zh-TW.md)

Personal layout and mods for [Herdr](https://herdr.dev), the desktop app for
terminals and coding agents. Built and tested against Herdr 0.1.18.

## What's inside

| Path | Description |
| --- | --- |
| `layouts/main-markdown-editor.json` | A clone of the built-in `main` layout with a Markdown file panel on the right. |
| `mods/files-markdown-editor/` | Files panel with Markdown preview, visual/source editing and save support. |
| `mods/spaces-shell-done/` | Spaces sidebar that shows a green dot when a command finishes in a space. |
| `mods/tabs-shell-done/` | Tab bar that flashes a high-contrast style when a command finishes in a tab. |
| `AGENTS.local.md` | Local notes for coding agents working in this configuration folder. |

## Features

### Markdown file panel

Browse files, preview Markdown, and switch between visual and source mode.
Edits can be saved, with dirty-state and external-change warnings.

### Command completion notifications

- A space shows a green dot when any of its terminals finishes a command.
- The tab flashes with a high-contrast style until you focus it.
- Once you open the tab, that completion is acknowledged and will not flash
  again, even after you switch away. Acknowledged events are stored in the
  shared key `shell.acknowledged`, keyed by the terminal's `turn`.
- A later command produces a new `turn`, so notifications start again.

Two completion sources are supported:

- Terminal label `herdr.shell-done=1`, typically set by a local shell hook.
- Herdr agent status `done` (OSC 7501), reported by an agent or by a shell hook
  running inside a remote session.

Both mods share the same acknowledgment state, so reading a notification in one
place also clears it in the other.

## Requirements

- Herdr 0.1.18 or later.

## Install

1. Copy `layouts/main-markdown-editor.json` into `~/.config/herdr-app/layouts/`.
2. Copy the three mod folders into `~/.config/herdr-app/mods/`.
3. Validate each mod:

   ```sh
   herdr-app check ~/.config/herdr-app/mods/files-markdown-editor
   herdr-app check ~/.config/herdr-app/mods/spaces-shell-done
   herdr-app check ~/.config/herdr-app/mods/tabs-shell-done
   ```

4. Switch to the layout:

   ```sh
   herdr-app do layout.switch --name main-markdown-editor
   ```

5. Restart your shell, or source your shell hook, so completion events are
   emitted for new commands.

## Remote SSH sessions (optional)

The mods also react to OSC 7501 `done` emitted from a remote bash session.
The companion scripts used for that (`hssh` and a bash rcfile hook) are local
helpers and are not included in this repository. You can use any other method
that emits the same OSC 7501 status.

## Notes

- These mods are clones of Herdr's built-in `files`, `spaces` and `tabs` mods.
  Check Herdr's license before redistributing derived code.
- Runtime state, telemetry, built-in layouts/mods and generated files are
  intentionally excluded by `.gitignore`.

## License

No license is declared yet. Treat this repository as personal configuration.
