import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared } from "herdr";

export default class FilesSettings extends View {
  init(_props, cx) {
    this.app = String(shared("files.editorApp") ?? "");
    this.input = InputState.new({ value: this.app, placeholder: "Visual Studio Code" });
    this.input.on("change", (_e, cx) => { this.app = this.input.value(); cx.notify(); });
    this.input.on("submit", () => this.save());
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  save() {
    setShared("files.editorApp", this.app.trim());
    closeOverlay(props().overlay);
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("files-settings").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Files 設定"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("預設編輯器（macOS App 名稱，留空使用系統預設）"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().pt(6).text_size(11).text_color(t.dim).child("例如：Visual Studio Code、Cursor、Zed"))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("files-settings-cancel", "取消", false, () => closeOverlay(props().overlay)))
        .child(button("files-settings-save", "儲存", true, () => this.save())));
  }
}