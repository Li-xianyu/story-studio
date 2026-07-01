# 浮光剧场 · 云同步服务端部署指南 (Cloudflare Workers)

本服务是“浮光剧场”的云同步后端，基于 **Cloudflare Workers** + **KV 键值存储** 构建。旨在为个人用户提供安全、免费的跨设备数据双向同步。

## 方案优势
1. **完全免费**：利用 Cloudflare 免费额度即可轻松承载（每天支持 10 万次免费请求，对于个人使用来说完全绰绰有余）。
2. **零服务器维护**：无服务器架构，不需管理服务器、系统更新或安全配置。
3. **数据隐私安全**：
   - 所有的 API Key 和密钥在上传前已被客户端**彻底剥离**，云端不保存任何模型密钥。
   - 数据完全保存在用户本人的 Cloudflare 账户中。
   - 通过唯一的随机安全 Token 凭证校验，无传统注册/登录的泄露隐患。

---

## 部署流程

### 第一步：准备环境
1. 确保你的电脑安装了 [Node.js](https://nodejs.org/)（建议使用 LTS 版本）。
2. 打开终端，进入 `sync-worker` 目录：
   ```bash
   cd sync-worker
   ```
3. 安装依赖（主要是 Cloudflare CLI 工具 `wrangler`）：
   ```bash
   npm install
   ```

### 第二步：登录 Cloudflare 账号
1. 如果你还没有 Cloudflare 账号，请先前往 [Cloudflare Dashboard](https://dash.cloudflare.com/) 免费注册一个。
2. 在终端运行以下命令登录：
   ```bash
   npx wrangler login
   ```
   *终端会自动弹出浏览器窗口，点击 **Allow** 授权即可。*

### 第三步：创建 KV 数据库
在终端运行以下两条命令创建存储数据库（一个正式版，一个预览版）：
```bash
# 1. 创建正式版 KV
npx wrangler kv namespace create SYNC_KV

# 2. 创建开发预览版 KV
npx wrangler kv namespace create SYNC_KV --preview
```

创建成功后，命令会输出包含 `id` 的配置片段。
打开项目下的 `wrangler.toml` 文件，将对应的 ID 替换进去：

```toml
[[kv_namespaces]]
binding = "SYNC_KV"
id = "这里填第一步生成的正式版 ID"
preview_id = "这里填第二步生成的预览版 ID"
```

### 第四步：部署上线
在终端运行部署命令：
```bash
npx wrangler deploy
```

部署完成后，终端会输出你的 Worker 服务 URL，例如：
`https://story-studio-sync.<YOUR_SUBDOMAIN>.workers.dev`

---

## 如何在浮光剧场使用

1. 打开浮光剧场网页。
2. 点击左下角的 **“模型与朗读设置”**，切换到 **“云同步”** 选项卡。
3. 在 **“同步服务器地址”** 输入框中，填写你刚刚部署得到的 Worker URL（例如 `https://story-studio-sync.xxx.workers.dev`）。
4. 点击右侧 **“生成 Token”**。系统会与你的云端握手并为你分配一个专用的随机密钥。
5. 点击下方 **“测试连接”**，如果弹出“连接成功！”，就大功告成了！
6. **多端同步**：在你的手机或其他设备上，填写相同的**同步服务器地址**和**同步凭证 (Token)**，即可实现数据的跨端无感双向同步。
