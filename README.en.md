<p align="center">
  <img src="assets/icon.png" width="120" alt="QCE AI Backup icon">
</p>

# QCE AI Backup

English | [简体中文](README.md)

A Windows desktop application for automatic QQ group-chat backup and AI-generated weekly summaries through QCE. On launch, it can inspect the seven most recent completed chat windows, backfill missing TXT exports, and combine multiple groups in one plan into the Markdown summary for the week that contains each window.

> This project relies on [shuakami/qq-chat-exporter (QCE)](https://github.com/shuakami/qq-chat-exporter) to read and export chat history. QCE is not bundled with this repository and must be installed and signed in separately.

## Features

- Automatically runs enabled plans when the application starts, with a per-plan switch.
- Checks the seven most recent completed windows. The default window runs from 03:00 on the previous day to 05:00 on the current day.
- Supports multiple QQ groups in one plan: each group is exported separately, while their AI summary is combined.
- Writes each result to the weekly Markdown file for the record's own date, not the application's run date.
- Supports one primary AI provider and multiple fallback providers, retried in order after a failure.
- Supports OpenAI-compatible endpoints, custom prompts, chunk summaries, and a final merge pass.
- Configures TXT backup and Markdown summary directories independently.
- Shows detailed progress for export, parsing, AI chunks, merge, and Markdown output.
- Supports Windows auto-launch, QCE quick login, automatic QCE lifecycle management, and QCE update checks.
- Keeps execution history to detect existing outputs and avoid duplicate work.

## Workflow

```text
Launch the app
  -> Load plans with “run automatically after app launch” enabled
  -> Inspect the seven most recent completed windows
  -> Backfill a separate TXT export for each group
  -> Combine all group records in the plan and call the AI in chunks
  -> Append the result to the Markdown summary for that window's week
```

## Requirements

- Windows 10/11 x64
- The Windows x64 build of [QCE](https://github.com/shuakami/qq-chat-exporter)
- An OpenAI-compatible API or another AI service supported by the application
- Node.js 20 or later for source builds; development currently uses Node.js 22

## Getting Started

1. Download the Windows x64 package from [QCE Releases](https://github.com/shuakami/qq-chat-exporter/releases), start it, and complete QQ sign-in.
2. Start `QCE AI Backup.exe`. In QCE Settings, select the QCE directory containing `launcher-user.bat`.
3. Configure the primary provider in AI Settings, then add fallback providers when required.
4. Create a plan in Task Settings, select one or more groups, and choose separate TXT and Markdown output directories.
5. Enable “run the plan automatically after app launch”. The next launch will check and backfill the seven most recent completed windows.
6. Open the progress window from the dashboard. Closing it does not stop the background job, and it can be reopened later.

## QCE Updates

The dashboard includes an Update QCE action. Software Settings can also enable automatic update checks on launch. When a new release is available, a dismissible notification appears in the top-right corner. The updater downloads the official Windows x64 archive from QCE's GitHub Releases and switches the configured QCE directory automatically. It uses the Windows system proxy by default, or an optional update proxy stored only in the local application settings.

QCE releases, licensing, and compatibility are maintained upstream. Refer to the [QCE repository](https://github.com/shuakami/qq-chat-exporter) for authoritative information.

## Development

```powershell
npm.cmd install
npm.cmd run dev
```

Build production assets:

```powershell
npm.cmd run build
```

Create the unpacked portable directory:

```powershell
npm.cmd run dist
```

The output is written to `release/win-unpacked`. This project does not produce an installer or a single-file portable executable.

If dependency downloads require a proxy, configure it in your own system, shell, or npm user settings. Do not commit an `.npmrc` containing credentials, tokens, or personal network settings.

## Privacy and Security

- This repository contains no user configuration, QQ numbers, group IDs, chat records, logs, backups, summaries, or API keys.
- Application settings are stored by Electron Store under the current Windows user's application-data directory, outside the source tree.
- TXT backups and Markdown summaries are written only to directories selected by the user.
- When AI summarization is enabled, chat content is sent to the AI service configured by the user. Review that service's privacy and data-processing terms first.
- Remove QQ numbers, group IDs, local paths, tokens, cookies, and chat content before sharing logs or screenshots.

See [SECURITY.md](SECURITY.md) for reporting guidance.

## Project Layout

```text
src/main/       Electron main process and QCE, backup, AI, and file services
src/preload/    Safe IPC bridge for the renderer
src/renderer/   React user interface
src/shared/     Utilities shared by the main process and UI
assets/         Application icons
```

## Disclaimer

This is an unofficial project and is not affiliated with Tencent QQ or the QCE maintainers. Only process chat records that you are authorized to access, and comply with applicable laws, group agreements, and service terms.
