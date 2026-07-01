# 浮光剧场

独立的 AI 互动小说播放器。无需构建，直接打开 `index.html`。

## 能力

- OpenAI 兼容接口，默认适配 DeepSeek
- 单模型连续续写
- 角色入戏、剧情指令、补充设定
- 章节、分支快照和本地故事库
- 自动整理剧情摘要、人物关系、世界状态和伏笔
- 系统 TTS 与 MiMo TTS
- 自动续写、自动朗读
- JSON / Markdown / TXT 导入，JSON 导出
- 可读取同源 MOYU 的当前接口和 TTS 配置

所有故事与设置保存在当前浏览器的 `localStorage` 中。

## 云端同步 (Cloud Sync)

项目支持跨设备云端数据同步（通过 Cloudflare Workers 实现）：
- **全免费 / 零自建服务器**：数据完全保存在你自己的 Cloudflare 个人账户中。
- **无感静默同步**：配置完成后，加载页面时自动拉取最新，修改故事时自动防抖推送到云端。
- **安全保障**：所有 API Key 等敏感配置在上传前会被本地强制剥离，绝不留存到云端。

关于服务端的部署，请查阅 [sync-worker/README.md](sync-worker/README.md) 了解详细指南。

