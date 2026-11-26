import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, shared, exec, notify, checking } from "herdr";

function selfCheck() {
  const assert = (ok, message) => { if (!ok) throw new Error(`files-menu self-check: ${message}`); };
  const p = { root: "/tmp/root", path: "a b/中文.txt", on: null };
  const full = `${p.root}/${p.path}`;
  assert(full === "/tmp/root/a b/中文.txt", "full path keeps spaces and unicode");
  const args = ["Visual Studio Code"].map((app) => ["-a", app, full]).flat();
  assert(args[0] === "-a" && args[2] === full, "editor args keep path as one argument");
}

export default class FilesMenu extends View {
  init(_props, cx) {
    if (checking()) selfCheck();
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  fullPath() { return `${props().root}/${props().path}`; }
  relativePath() { return props().path; }

  choose(i, cx) {
    const list = this.items();
    const item = list[i];
    if (!item) return;
    closeOverlay(props().overlay);
    if (item.action === "copy-full") cx.write_to_clipboard(this.fullPath());
    else if (item.action === "copy-relative") cx.write_to_clipboard(this.relativePath());
    else if (item.action === "open-editor") {
      const p = props();
      const app = shared("files.editorApp");
      if (p.on) {
        notify({ title: "遠端檔案", body: "無法在本機編輯器開啟", level: "warning", timeout: 2000 });
        return;
      }
      cx.spawn(async (cx) => {
        try {
          const args = app ? ["-a", app, this.fullPath()] : [this.fullPath()];
          const r = await exec("open", args);
          if (r.code !== 0) notify({ title: "無法開啟編輯器", body: r.stderr || r.stdout || "請檢查設定", level: "error", timeout: 3000 });
        } catch (e) {
          notify({ title: "無法開啟編輯器", body: String(e), level: "error", timeout: 3000 });
        }
      });
    }
  }

  items() {
    return [
      { label: "複製完整路徑", action: "copy-full" },
      { label: "複製相對路徑", action: "copy-relative" },
      { label: "使用編輯器開啟", action: "open-editor" },
    ];
  }

  render(cx) {
    const t = theme();
    const list = this.items();
    return v_flex().id("files-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_mouse_down_out(() => closeOverlay(props().overlay))
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(list.map((item, i) =>
        h_flex().id(`fm-${i}`).h(31).px(8).gap(9).rounded(7).items_center().justify_between()
          .text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(i, cx))
          .child(div().flex_1().child(item.label))));
  }
}