# 使用者偏好與本機須知

- 與使用者互動一律使用繁體中文。
- 這是 Herdr 的執行期設定目錄，不是一般程式碼 repository；沒有 build、test 或 lint 指令。
- `AGENTS.md` 由 Herdr 每次啟動重寫，不要修改；長期筆記只放在本檔。
- `herdr.d.ts`、`gpui-kit.d.ts` 是當前版本的 API 依據，也由 Herdr 重寫，不要編輯。
- 修改 layout、key、setting 或 mod 會立即生效；每次改完執行 `herdr-app status`，確認 `errors` 為空。
- 內建 layout/mod 是唯讀的；要客製先 clone，只修改複本：
  `herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`
  `herdr-app do mod.clone '{"name":"files","as":"my-files"}'`
- Mod 改完必須執行 `herdr-app check ~/.config/herdr-app/mods/<name>`，並在 app 內實測；檢查 UI 可用 `herdr-app shot`。
- 不要手動修改 Herdr 管理的執行期檔案：`frame/`、`icons/`、`layouts/.state/`、`view.json`、`shared.json`。
- 版面或鍵位壞掉時，按 `ctrl-alt-shift-escape` 可回到內建 `main` layout。
- `README.md`（英文）與 `README.zh-TW.md`（繁中）必須保持內容同步；更新任一檔案時，必須同步更新另一個，並保留兩者頂端的語言切換連結。
