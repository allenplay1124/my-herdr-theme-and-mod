// A lazy file browser with Markdown previews, block editing and source editing.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window, checking } from "herdr";
import { isMarkdown, blocks as markdownBlocks, applyBlockEdit, selfCheck as checkMarkdown } from "./markdown.js";

// The panels share data in one VM, but their host tasks belong to separate copies.
const scans = globalThis[Symbol.for("herdr.repoStatus.v2")] ??= new Map();

async function repoStatus(root, on, { after, visiting, urgent, allowInactive }, cx, current) {
  const repo = JSON.stringify([on, root]), now = Date.now();
  for (const [key, scan] of scans) {
    if (scan.pollAt <= now || (!scan.pollAt && scan.task.is_done())) scans.delete(key);
  }
  while (current()) {
    let scan = scans.get(repo);
    const pending = scan && !scan.pollAt && !scan.task.is_done();
    const reusable = scan?.status?.code === 0 && Date.now() < scan.pollAt
      && (scan.started >= after || (!urgent && Date.now() < scan.watchAt));
    if (!reusable && (!pending || (visiting && scan.started !== undefined && scan.started < after))) {
      if (!allowInactive && window()?.active === false) return null;
      const next = {};
      next.task = cx.spawn(async cx => {
        await cx.sleep(25); // Let both listeners for a watch batch join before starting Git.
        if (!allowInactive && window()?.active === false) return;
        next.started = Date.now();
        try {
          next.status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: root, on });
        } catch (error) {
          next.error = error;
        } finally {
          const finished = Date.now(), duration = finished - next.started;
          const delay = duration < 500 ? 0 : Math.min(60000, 5 * duration);
          next.watchAt = finished + delay;
          next.pollAt = finished + Math.max(10000, delay);
          if (next.status?.code !== 0 && scans.get(repo) === next) scans.delete(repo);
        }
      });
      scans.set(repo, next);
      scan = next;
    }
    // Resume through our own host task, so another copy's close cannot cancel our follow-up work.
    while (current() && !scan.pollAt && !scan.task.is_done()) await cx.sleep(50);
    if (!current()) return null;
    if (!scan.pollAt) continue; // The scanning copy closed or reloaded.
    return scan;
  }
  return null;
}

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000, MD_LIMIT = 400000;

function syntax(t, markdown) {
  const base = { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 };
  return markdown ? { ...base, heading: t.ansi4, strong: t.ansi5, emphasis: t.ansi3, code: t.ansi2, quote: t.dim, list: t.ansi5, link: t.ansi4 } : base;
}

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    if (checking()) checkMarkdown();
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pendingFolders = new Set(); this.marks = {};
    this.pending = null; this.md = false; this.editable = false; this.mode = "visual";
    this.source = null; this.draft = null; this.dirty = false; this.blocks = []; this.syncing = false;
    this.editIndex = null; this.blockState = null; this.note = null; this.noteError = false;
    this.refresh(cx);
    cx.timer.every(500, cx => this.refreshIfDue(cx));
  }

  refreshIfDue(cx) {
    const active = window()?.active !== false, context = this.context;
    const refocused = active && this.windowActive === false;
    this.windowActive = active;
    if (!context) return;
    if (refocused && (context.dirtyAt || !context.watch)) context.catchUp = true;
    if (!active || this.loading) return;
    const now = Date.now();
    if (context.catchUp || (context.dirtyAt && now >= context.watchAt) || now >= context.pollAt) this.refresh(cx);
  }

  watch(root, context, cx) {
    if (context.on || context.watch?.root === root) return;
    context.watch?.pending?.cancel();
    const watch = { root };
    context.watch = watch;
    cx.spawn(async cx => {
      try {
        while (this.context === context && context.watch === watch) {
          watch.pending = watchFolder(root);
          const paths = await watch.pending;
          if (paths.length && context.watch === watch && this.current(context)) {
            context.dirtyAt = Date.now() + 1;
            this.refreshIfDue(cx);
          }
        }
      } catch {
        if (context.watch === watch) context.watch = null;
      }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    if (this.pending) return;
    const { cwd, on } = location(), next = key();
    const visiting = next !== this.context?.key;
    if (visiting && this.dirty) {
      this.pending = { kind: "context", cwd, on, key: next };
      cx.notify();
      return;
    }
    if (visiting) {
      if (this.context) {
        this.saved.set(this.context.key, { folders: this.folders, file: this.file });
        this.context.watch?.pending?.cancel();
      }
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on, dirtyAt: 0 }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pendingFolders = new Set(); this.marks = {}; this.show(null); this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    const context = this.context;
    const now = Date.now();
    if (!cwd) {
      context.catchUp = false;
      context.dirtyAt = 0;
      context.pollAt = now + 10000;
      return;
    }
    if (this.loading) return;
    if (context.catchUp && !context.dirtyAt) context.dirtyAt = now + 1;
    const request = {
      after: visiting ? now + 1 : context.dirtyAt || (context.lastStatus ?? -1) + 1,
      visiting,
      urgent: visiting || context.catchUp,
      allowInactive: visiting,
    };
    context.catchUp = false;
    context.pollAt = context.watchAt = now + 10000;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        this.watch(cwd, context, cx);
        const dirtyAtListing = context.dirtyAt;
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        if (!this.current(context)) return;
        const marks = {};
        let covered = dirtyAtListing;
        if (top?.code === 0) {
          const root = top.stdout.trim();
          const scan = await repoStatus(root, on, request, cx, () => this.context === context);
          if (!scan || !this.current(context)) return;
          const { status, started, pollAt, watchAt } = scan;
          context.lastStatus = started;
          context.pollAt = pollAt;
          context.watchAt = watchAt;
          covered = Math.min(dirtyAtListing, started);
          if (request.urgent && request.after > started) context.catchUp = true;
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${root}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        } else {
          context.watchAt = Date.now();
        }
        if (!this.current(context)) return;
        if (context.dirtyAt <= covered) context.dirtyAt = 0;
        this.marks = marks; this.error = null;
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally {
        if (this.context === context) this.loading = false;
        cx.notify();
      }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pendingFolders.has(path)) {
        const context = this.context;
        this.pendingFolders.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pendingFolders.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  releaseEditors() {
    this.code?.release(); this.code = null;
    this.blockState?.release(); this.blockState = null;
    this.editIndex = null; this.blocks = [];
  }

  show(path, cx) {
    if (this.dirty && path !== this.file) {
      this.pending = { kind: "file", path };
      cx.notify();
      return;
    }
    this.releaseEditors();
    this.file = path; this.fileError = null; this.note = null; this.noteError = false;
    this.md = false; this.editable = false; this.mode = "visual";
    this.source = null; this.draft = null; this.dirty = false;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.md = isMarkdown(path);
        this.editable = this.md && !on && text.length <= MD_LIMIT;
        this.note = this.md && !this.editable ? (on ? "遠端 Markdown · 只能預覽" : "檔案過大 · 唯讀預覽") : null;
        if (this.editable) {
          this.source = text; this.draft = text; this.blocks = markdownBlocks(text);
        }
        this.makeCode(t, this.md, this.editable, ext, text);
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  makeCode(t, markdown, editable, ext, text) {
    this.code = EditorState.new({
      language: markdown ? "markdown" : LANG[ext] ?? ext,
      value: editable ? this.draft : text.length > MD_LIMIT ? text.slice(0, MD_LIMIT) + "\n… (file truncated)" : text,
      readonly: !editable, soft_wrap: markdown, syntax: syntax(t, markdown),
    });
    if (editable) this.code.on("change", (_e, cx) => {
      if (this.syncing) return;
      this.draft = this.code.value();
      this.dirty = this.draft !== this.source;
      cx.notify();
    });
  }

  syncCode() {
    if (!this.code) return;
    this.syncing = true;
    this.code.set_value(this.draft);
    this.syncing = false;
  }

  setMode(mode, cx) {
    if (!this.editable || mode === this.mode) return;
    this.finishBlock();
    if (mode === "source") this.syncCode();
    else this.blocks = markdownBlocks(this.draft);
    this.mode = mode;
    cx.notify();
  }

  finishBlock() {
    this.blockState?.release(); this.blockState = null;
    this.editIndex = null;
  }

  editBlock(index, cx) {
    if (!this.editable || this.mode !== "visual") return;
    this.finishBlock();
    const at = index, block = this.blocks[at];
    if (!block) return;
    const t = theme();
    this.editIndex = at;
    this.blockState = EditorState.new({ language: "markdown", value: block.text, readonly: false,
      line_numbers: false, folding: false, soft_wrap: true, tab_size: 2, syntax: syntax(t, true) });
    this.blockState.on("change", (_e, cx) => {
      if (this.editIndex !== at || !this.blockState) return;
      const value = this.blockState.value(), next = applyBlockEdit(this.draft, this.blocks, at, value);
      this.draft = next.text; this.blocks = next.blocks;
      this.dirty = this.draft !== this.source;
      this.syncCode();
      cx.notify();
    });
    this.blockState.focus();
    cx.notify();
  }

  addBlock(cx) {
    if (!this.editable || this.mode !== "visual") return;
    this.finishBlock();
    const separator = !this.draft ? "" : this.draft.endsWith("\n\n") ? "" : this.draft.endsWith("\n") ? "\n" : "\n\n";
    const start = this.draft.length + separator.length;
    this.draft += separator;
    this.blocks.push({ start, end: start, text: "", kind: "paragraph" });
    this.dirty = this.draft !== this.source;
    this.syncCode();
    this.editBlock(this.blocks.length - 1, cx);
  }

  save(cx) {
    if (!this.editable || !this.dirty || !this.file) return;
    const root = this.root, file = this.file, text = this.draft, expected = this.source, context = this.context;
    cx.spawn(async cx => {
      try {
        await writeTextFile(`${root}/${file}`, text, expected);
        if (this.file === file && this.current(context)) {
          this.source = text; this.dirty = false; this.note = "已儲存"; this.noteError = false;
          context.dirtyAt = Date.now() + 1;
        }
        this.resolvePending(cx);
      } catch {
        if (this.file === file && this.current(context)) {
          this.note = "檔案已變更，請先重新載入"; this.noteError = true;
        }
      }
      cx.notify();
    });
  }

  discard(cx) {
    if (this.editable) {
      this.draft = this.source; this.dirty = false;
      this.blocks = markdownBlocks(this.draft);
      this.finishBlock(); this.syncCode();
    }
    this.note = null; this.noteError = false;
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      if (pending.kind === "file") this.show(pending.path, cx);
      else this.refresh(cx);
    }
    cx.notify();
  }

  reload(cx) {
    const path = this.file;
    if (!path) return;
    this.dirty = false;
    this.show(path, cx);
  }

  resolvePending(cx) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    if (pending.kind === "file") this.show(pending.path, cx);
    else this.refresh(cx);
  }

  renderBlock(block, index, t) {
    const active = this.editIndex === index;
    const body = active
      ? Editor.new(this.blockState).font_family(settings().font_family).text_size(settings().font_size).flex_1().min_h(24)
      : TextView.markdown(`md-block-${index}`, block.text || " ").selectable(true).raw_html(false).text_size(settings().font_size);
    return v_flex().id(`md-block-${index}`).w_full().flex_none().rounded(8).border(1)
      .border_color(active ? t.accent : t.border).p(8).gap(6).hover(s => s.bg(t.hover))
      .on_click((_e, cx) => { if (!active) this.editBlock(index, cx); })
      .when(active, el => el.child(h_flex().justify_end().child(div().id(`md-done-${index}`)
        .px(6).py(2).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.finishBlock(); cx.notify(); }).child("完成"))))
      .child(body);
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/files-markdown-editor/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/files-markdown-editor/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (this.pending) this.refreshIfDue(cx);
    else if (key() !== this.context?.key) this.refresh(cx);
    else this.refreshIfDue(cx);
    const t = theme(), font = settings();
    const small = (id, label, color, onClick, bg = t.raised) =>
      div().id(id).px(7).py(3).rounded(6).bg(bg).text_color(color).cursor_pointer()
        .hover(s => s.bg(t.hover)).on_click(onClick).child(label);
    const modeButton = (id, label, mode) => small(id, label, this.mode === mode ? t.accent : t.muted,
      (_e, cx) => this.setMode(mode, cx), this.mode === mode ? t.selected : t.chrome);
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(44).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(18).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null, cx); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .when(this.md && this.editable, el => el.child(modeButton("md-visual", "視覺", "visual")).child(modeButton("md-source", "原始碼", "source")))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))
        .when(this.md && this.editable, el => el.child(small("md-save", this.dirty ? "儲存" : "已儲存", this.dirty ? t.accent : t.dim, (_e, cx) => this.save(cx)))))
      .when(Boolean(this.note), el => el.child(h_flex().flex_none().px(12).py(4).gap(10).items_center()
        .child(div().flex_1().min_w(0).text_size(11).text_color(this.noteError ? t.blocked : t.dim).child(this.note))
        .when(this.noteError, el => el.child(small("md-reload", "重新載入", t.blocked, (_e, cx) => this.reload(cx))))))
      .when(Boolean(this.pending), el => el.child(h_flex().h(34).flex_none().px(12).gap(8).items_center().bg(t.raised)
        .child(div().flex_1().text_size(11).text_color(t.blocked).child("有未儲存的變更"))
        .child(small("md-pending-save", "儲存", t.accent, (_e, cx) => this.save(cx)))
        .child(small("md-pending-discard", "捨棄", t.muted, (_e, cx) => this.discard(cx)))))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(
        this.md && this.editable && this.mode === "visual"
          ? v_flex().id("md-visual").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(8)
            .children(this.blocks.map((block, i) => this.renderBlock(block, i, t)))
            .child(div().id("md-add").py(6).text_size(11).text_color(t.dim).cursor_pointer()
              .hover(s => s.text_color(t.accent)).on_click((_e, cx) => this.addBlock(cx)).child("＋ 新增段落"))
          : this.code
            ? Editor.new(this.code).font_family(font.font_family).text_size(font.font_size).flex_1().min_h(0)
            : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
