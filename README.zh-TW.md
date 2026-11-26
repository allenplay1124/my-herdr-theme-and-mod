# 我的 Herdr 主題與 Mod

[English](README.md) | [繁體中文](README.zh-TW.md)

這是給 [Herdr](https://herdr.dev) 使用的個人版面與 mod；Herdr 是一個用於終端機與 coding agent 的桌面應用程式。以 Herdr 0.1.18 為基礎開發與測試。

## 包含的檔案

| 路徑 | 說明 |
| --- | --- |
| `layouts/main-markdown-editor.json` | 由內建 `main` 版面複製而來，右側加入 Markdown 檔案面板。 |
| `mods/files-markdown-editor/` | 檔案面板，支援 Markdown 預覽、視覺／原始碼編輯與儲存。 |
| `mods/spaces-shell-done/` | 空間側欄；空間內的指令結束時顯示綠點。 |
| `mods/tabs-shell-done/` | 分頁列；分頁內的指令結束時以高反差樣式閃爍。 |
| `AGENTS.local.md` | 給在此設定目錄工作的 coding agent 使用的本機注意事項。 |

## 功能

### Markdown 檔案面板

可瀏覽檔案、預覽 Markdown，並在視覺模式與原始碼模式之間切換。
支援儲存，且有未儲存變更與外部檔案變更的提醒。

### 指令完成通知

- 空間內任一終端機完成指令時，該空間會顯示綠點。
- 分頁內的指令完成時，分頁會以高反差樣式閃爍，直到你點開該分頁。
- 一旦開啟該分頁，這次完成事件就會被標記為已讀，之後再切走也不會重新閃爍。
  已讀記錄存放在共用索引鍵 `shell.acknowledged`，以終端機的 `turn` 做為事件 ID。
- 下一次指令會產生新的 `turn`，因此通知會再次生效。

支援兩種完成來源：

- 終端機標籤 `herdr.shell-done=1`，通常由本機 shell hook 設定。
- Herdr agent 狀態 `done`（OSC 7501），由 agent 或遠端工作階段中的 shell hook 回報。

兩個 mod 共用同一份已讀狀態，因此在其中一處讀取通知後，另一處也會清除。

## 需求

- Herdr 0.1.18 或更新版本。

## 安裝

1. 將 `layouts/main-markdown-editor.json` 複製到 `~/.config/herdr-app/layouts/`。
2. 將三個 mod 資料夾複製到 `~/.config/herdr-app/mods/`。
3. 檢查每個 mod：

   ```sh
   herdr-app check ~/.config/herdr-app/mods/files-markdown-editor
   herdr-app check ~/.config/herdr-app/mods/spaces-shell-done
   herdr-app check ~/.config/herdr-app/mods/tabs-shell-done
   ```

4. 切換到該版面：

   ```sh
   herdr-app do layout.switch --name main-markdown-editor
   ```

5. 重新啟動 shell，或載入你的 shell hook，讓新指令會發出完成事件。

## 遠端 SSH 工作階段（選用）

這兩個 mod 也會對遠端 bash 工作階段發出的 OSC 7501 `done` 做出反應。
為此使用的輔助程式（`hssh` 與 bash rcfile hook）僅存在於本機，並未包含在這個 repository 中。
你也可以使用其他能發出相同 OSC 7501 狀態的方式。

## 注意事項

- 這幾個 mod 是從 Herdr 內建的 `files`、`spaces`、`tabs` mod 複製而來。
  重新散布衍生程式碼前，請確認 Herdr 的授權條款。
- 執行期狀態、telemetry、內建版面／mod 與產生檔案都已由 `.gitignore` 排除。

## 授權

目前未指定授權。請將本 repository 視為個人設定。
