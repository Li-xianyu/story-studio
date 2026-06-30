# 浮光剧场 · 开发者指南 (Development Guide)

欢迎参与 **浮光剧场 (story-studio)** 的开发！为了保持代码整洁、高效，并防止逻辑冗余，请在编写或重构代码时遵循以下指南。

---

## 🛠️ 公用工具与规约 (Utilities & Conventions)

项目在 [js/core/utils.js](file:///c:/Users/Lenovo/Desktop/story-studio/js/core/utils.js) 中维护了一套核心的基础工具函数，请**优先使用**它们，切勿在各自的业务模块中重复实现或复制粘贴。

### 1. HTML 转义 (`escapeHtml`)
*   **用途**：防止 XSS 攻击，将 HTML 特殊字符进行安全转义（包括单双引号）。
*   **调用**：
    ```javascript
    import { escapeHtml } from "../core/utils.js";
    var safeString = escapeHtml(userInput);
    ```
*   *注意：请不要在模块中私有实现 `escapeHtmlSafe` 或其他的正则替换函数。*

### 2. 状态机与 Loading 控制 (`setBusy`)
*   **用途**：统一管理编辑与生成状态（包括显示置顶进度条、切换发送/停止按钮、禁用输入框等）。
*   **调用**：
    ```javascript
    import { setBusy } from "../core/utils.js";
    setBusy(el, true, "正在执行操作..."); // 开启忙碌状态
    setBusy(el, false);                  // 恢复就绪
    ```
*   *注意：如果模块需要维护 `state.generating`，可在调用 `setBusy` 的同时手动更新该状态，或使用封装好的业务包装器（如 `setMemoryGenerating`），不要直接操作 DOM 节点。*

### 3. 安全 JSON 解析与抢救 (`safeParse` / `tryRepairJson`)
*   **用途**：
    *   `safeParse(raw, fallback)`：普通的 `JSON.parse` 容错封装，解析失败时返回默认值。
    *   `tryRepairJson(jsonStr)`：**AI 生成内容专用**。针对大模型可能发生的输出截断、包含 Markdown 标记（如 ` ```json `）等情况进行强力抢救，自动剔除尾部残缺字符并补全未闭合的括号。
*   **调用**：
    ```javascript
    import { safeParse, tryRepairJson } from "../core/utils.js";
    var data = tryRepairJson(aiRawResponse);
    ```

---

## 🖱️ 事件绑定与 DOM 交互 (DOM & Events)

### 1. 优先使用事件委托 (Event Delegation)
当需要给多个重复的 DOM 元素（如列表项、弹窗背景等）绑定事件时，**绝对不要**使用 `querySelectorAll` 循环绑定。
*   **正例**（弹窗外部点击自动关闭）：
    ```javascript
    document.addEventListener("click", function (event) {
      var dialog = event.target.closest("dialog.modal");
      if (dialog && event.target === dialog) {
        // 执行关闭逻辑...
      }
    });
    ```
*   **反例**：在页面加载时获取所有 `dialog` 元素并循环加监听器（这会导致动态创建的弹窗无法获得该交互）。

---

## 🎨 代码风格 (Code Style)

1.  **ES5 兼容性**：项目使用原生的浏览器 ES 模块，但逻辑代码编写尽量保持高兼容性（使用 `var`、传统的匿名函数 `function () {}` 等），避免引入未经编译的复杂 ES6+ 特性。
2.  **模块单一职责**：
    *   [js/core/](file:///c:/Users/Lenovo/Desktop/story-studio/js/core/) 存放纯逻辑、数据层、TTS、IndexedDB 操作。
    *   [js/ui/](file:///c:/Users/Lenovo/Desktop/story-studio/js/ui/) 负责渲染 (`renderer.js`)、图表 (`relation-graph.js`) 和页面交互监听 (`events.js`)。
    *   [js/story/](file:///c:/Users/Lenovo/Desktop/story-studio/js/story/) 存放具体的交互故事业务逻辑（记忆整理、分支管理等）。
