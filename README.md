<p align="center">
  <img src="assets/icon.png" width="120" alt="QCE AI Backup 图标">
</p>

# QCE AI Backup

[English](README.en.md) | 简体中文

基于 QCE 的 Windows QQ 群聊自动备份与 AI 周总结桌面工具。它可以在软件启动后检查最近 7 个完整聊天周期，补齐缺失的 TXT 备份，并将同一计划内多个群聊的内容合并总结到对应日期所在周的 Markdown 文件。

> 本项目依赖 [shuakami/qq-chat-exporter（QCE）](https://github.com/shuakami/qq-chat-exporter) 读取和导出聊天记录。QCE 不包含在本仓库中，需要单独安装并登录 QQ。

## 功能

- 软件启动后自动执行已开启的计划，也可随时关闭自动执行。
- 检查最近 7 个已完成周期，默认周期为前一天 03:00 至当天 05:00，并自动补漏。
- 一个计划可包含多个群聊：聊天记录分别导出，AI 总结合并生成。
- 按记录所属周写入周总结，而不是按软件运行当天归档。
- 支持主 AI 和多个备用 AI；主服务失败后依次重试备用服务。
- 支持 OpenAI 兼容接口、自定义提示词、分块总结与最终合并。
- TXT 备份目录和 Markdown 总结目录可分别设置。
- 提供备份、解析、AI 分块、合并和写入 Markdown 的实时进度。
- 支持开机启动、QCE 快速登录、QCE 自动启停和自动检查更新。
- 自动任务历史可用于判断已有备份并避免重复执行。

## 工作流程

```text
启动软件
  -> 读取开启了“软件启动后自动进行计划”的任务
  -> 逐个检查最近 7 个完整周期
  -> 为每个群聊分别补齐 TXT 备份
  -> 合并同一计划内各群聊的记录并分块调用 AI
  -> 将结果追加到该周期所在周的 Markdown 总结
```

## 环境要求

- Windows 10/11 x64
- [QCE](https://github.com/shuakami/qq-chat-exporter) Windows x64 版本
- 用于总结的 OpenAI 兼容 API，或软件支持的其他 AI 服务
- 从源码运行时需要 Node.js 20 或更高版本；当前开发环境使用 Node.js 22

## 使用方法

1. 从 [QCE Releases](https://github.com/shuakami/qq-chat-exporter/releases) 下载 Windows x64 版本，启动并完成 QQ 登录。
2. 启动 `QCE AI Backup.exe`，在“QCE 设置”中选择包含 `launcher-user.bat` 的 QCE 目录。
3. 在“AI 设置”中填写主 AI；需要容灾时继续添加备用 AI。
4. 在“任务设置”中新建计划，选择一个或多个群聊，并分别设置 TXT 与 Markdown 保存目录。
5. 打开“软件启动后自动进行计划”。下次启动软件时会自动检查和补齐最近 7 个完整周期。
6. 可在仪表盘打开进度窗口；窗口关闭后仍可再次打开，不会中断后台任务。

## QCE 更新

仪表盘提供“更新 QCE”按钮。软件设置中还可以开启“软件启动时自动检查 QCE 更新”；发现新版本后，主界面右上角会显示可关闭的提醒。更新过程会从 QCE 官方 GitHub Releases 下载 Windows x64 包，并自动切换软件中的 QCE 目录。网络默认使用 Windows 系统代理，也可以在“QCE 设置”中填写仅保存在本机的更新代理地址。

QCE 的发布、协议和兼容性由其上游项目维护，请以 [QCE 仓库](https://github.com/shuakami/qq-chat-exporter) 的说明为准。

## 从源码运行

```powershell
npm.cmd install
npm.cmd run dev
```

构建生产文件：

```powershell
npm.cmd run build
```

生成目录版便携程序：

```powershell
npm.cmd run dist
```

输出目录为 `release/win-unpacked`。本项目不生成安装程序，也不生成单文件便携版。

如需代理下载依赖，请在自己的系统、终端或 npm 用户配置中设置代理；不要把包含账号、令牌或个人网络配置的 `.npmrc` 提交到仓库。

## 隐私与安全

- 仓库不包含任何用户配置、QQ 号、群号、聊天记录、日志、备份、总结或 API Key。
- 软件配置通过 Electron Store 保存在当前 Windows 用户的数据目录中，不在程序源码目录内。
- TXT 备份和 Markdown 总结只写入用户选择的本地目录。
- 启用 AI 总结后，聊天内容会发送到你配置的 AI 服务。请先确认该服务的隐私政策和数据处理规则。
- 分享错误日志或截图前，请移除 QQ 号、群号、本机路径、Token、Cookie 和聊天内容。

更多报告建议见 [SECURITY.md](SECURITY.md)。

## 项目结构

```text
src/main/       Electron 主进程、QCE、备份、AI 与文件服务
src/preload/    安全的渲染进程 IPC 接口
src/renderer/   React 用户界面
src/shared/     主进程与界面共享的工具
assets/         应用图标
```

## 说明

本项目是非官方工具，与腾讯 QQ 或 QCE 上游维护者不存在隶属关系。请仅备份你有权访问和处理的聊天记录，并遵守所在地法律、群成员约定及所使用服务的条款。
