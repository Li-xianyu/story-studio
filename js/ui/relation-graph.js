/* ============================================================
   浮光剧场 · 人物关系图
   依赖：AntV G6 5.x (window.G6)
   解析 story.memory.characters → 人物关系图
   ============================================================ */

var graphInstance = null;
var currentParsed = null;

/* ---- 主题颜色 ---- */
function getThemeColors() {
  var isLight = document.documentElement.getAttribute("data-theme") === "light";
  if (isLight) {
    return {
      nodeFill: "#f6f8fa",
      nodeStroke: "#d1d5db",
      protoFill: "#eff6ff",
      protoStroke: "#93c5fd",
      protoHalo: "rgba(59,130,246,0.15)",
      labelFill: "#1f2937",
      edgeStroke: "#cbd5e1",
      edgeLabelFill: "#6b7280",
      activeStroke: "#3b82f6",
      bgColor: "#f9fafb"
    };
  }
  return {
    nodeFill: "rgba(255,255,255,0.06)",
    nodeStroke: "rgba(255,255,255,0.10)",
    protoFill: "rgba(59,130,246,0.12)",
    protoStroke: "rgba(59,130,246,0.28)",
    protoHalo: "rgba(59,130,246,0.10)",
    labelFill: "rgba(255,255,255,0.85)",
    edgeStroke: "rgba(255,255,255,0.08)",
    edgeLabelFill: "rgba(255,255,255,0.40)",
    activeStroke: "#3b82f6",
    bgColor: "#0a0a0c"
  };
}

/* ---- 解析器 ---- */
export function parseRelationGraph(text) {
  if (!text) return null;

  var nodeMap = {}, descMap = {}, nodes = [], edges = [], nextId = 1, edgeSet = {};

  function nodeId(name, lineContext) {
    name = String(name || "").trim();
    if (!name) return null;
    name = name.replace(/[（(][^）)]*[）)]?$/, "").trim();
    name = name.replace(/^["《「『]+|["》」』），,，。.：:\s]+$/g, "").trim();
    if (!name || name.length > 16) return null;
    if (!nodeMap[name]) {
      var id = "n" + nextId++;
      nodeMap[name] = id;
      nodes.push({ id: id, label: name, name: name, desc: "" });
      descMap[name] = [];
    }
    if (lineContext && descMap[name].indexOf(lineContext) === -1) descMap[name].push(lineContext);
    return nodeMap[name];
  }

  function addEdge(a, b, label, mutual) {
    if (!a || !b || a === b) return;
    if (!label) label = "关联";
    var key = a < b ? a + "|||" + b : b + "|||" + a;
    if (edgeSet[key]) return;
    edgeSet[key] = true;
    edges.push({ from: a, to: b, label: label, mutual: mutual });
  }

  if (typeof text === "string" && text.trim().startsWith("[")) {
    try {
       var arr = JSON.parse(text);
       if (Array.isArray(arr)) {
         text = arr;
       }
    } catch(e) {}
  }

  if (Array.isArray(text)) {
      text.forEach(function(item) {
        if (item && item.source && item.target) {
           addEdge(nodeId(item.source, item.relation), nodeId(item.target, item.relation), item.relation || "关联", item.mutual);
        }
      });
      return { nodes: nodes, edges: edges };
  }

  var lines = typeof text === "string" ? text.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
  if (!lines.length) return null;

  // Old node/edge logic kept for backwards compatibility parsing

  var reDash = /^(.+?)\s*(?:——+|—|–)\s*(.+?)\s*(?:——+|—|–)\s*(.+)$/;
  var reParen = /^(.+?)[（(](.+?)[）)](.+)$/;
  var reNameDesc = /^(.{2,12}?)\s*[：:]\s*(.+)$/;
  var reColonWith = /^(.+?)[：:]\s*与\s*(.+?)[是是为有]+\s*(.+)$/;
  var reAndColon = /^(.+?)\s*与\s*(.+?)\s*[：:]\s*(.+)$/;
  var reCommaColon = /^(.+?)[，,]\s*(.+?)\s*[：:]\s*(.+)$/;

  lines.forEach(function (line) {
    line = line.replace(/^[\s•·\-\*#]+\s*/, "").trim();
    if (!line) return;
    var m;
    if ((m = line.match(reNameDesc))) {
      if (!/^[\u4e00-\u9fa5]{1,4}$/.test(m[2].trim())) { nodeId(m[1].trim(), line); return; }
    }
    if ((m = line.match(reDash))) { addEdge(nodeId(m[1], line), nodeId(m[3], line), m[2].trim()); return; }
    if ((m = line.match(reParen))) {
      var rel = m[2].trim();
      if (rel && rel.length >= 2 && rel.length <= 16 && !/^\d+$/.test(rel)) { addEdge(nodeId(m[1], line), nodeId(m[3], line), rel); return; }
    }
    if ((m = line.match(reColonWith))) { addEdge(nodeId(m[1], line), nodeId(m[2], line), m[3].trim()); return; }
    if ((m = line.match(reAndColon))) { addEdge(nodeId(m[1], line), nodeId(m[2], line), m[3].trim()); return; }
    if ((m = line.match(reCommaColon))) {
      if (m[1].length <= 6 && m[2].length <= 6) { addEdge(nodeId(m[1], line), nodeId(m[2], line), m[3].trim()); return; }
    }
    var head = line.split(/[，,。.：:；;\s—\-（(]/)[0];
    if (head && head.length >= 2 && head.length <= 8) nodeId(head, line);
  });

  nodes.forEach(function (n) { n.desc = (descMap[n.name] || []).join("\n"); });
  if (!nodes.length) return null;
  return { nodes: nodes, edges: edges };
}

/* ---- 打开/关闭 ---- */

function destroyGraph() {
  if (graphInstance) {
    try { graphInstance.destroy(); } catch (e) {}
    graphInstance = null;
  }
}

export function openRelationGraph(story) {
  var dialog = document.getElementById("relationGraphDialog");
  var container = document.getElementById("relationGraphContainer");
  var emptyBox = document.getElementById("relationGraphEmpty");
  if (!dialog || !container || !emptyBox) return;

  destroyGraph();

  var text = story && story.memory ? (story.memory.characters || "") : "";
  var parsed = parseRelationGraph(text);

  if (!parsed || !parsed.nodes.length) {
    container.style.display = "none";
    emptyBox.style.display = "";
    if (!text.trim()) {
      emptyBox.innerHTML =
        '<div class="rg-empty-icon"><i data-lucide="users"></i></div>' +
        '<p class="rg-empty-title">还没有整理人物关系</p>' +
        '<p class="rg-empty-hint">点击「整理故事记忆」后，人物关系将在此以关系图呈现。</p>';
    } else {
      emptyBox.innerHTML =
        '<div class="rg-empty-icon"><i data-lucide="git-branch"></i></div>' +
        '<p class="rg-empty-title">未能识别关系结构</p>' +
        '<p class="rg-empty-hint">当前记忆格式无法解析为关系图，以下是原文：</p>' +
        '<pre class="rg-raw-text">' + escapeHtmlSafe(text) + '</pre>';
    }
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    dialog.showModal();
    return;
  }

  currentParsed = parsed;
  container.style.display = "";
  emptyBox.style.display = "none";
  emptyBox.innerHTML = "";

  if (!window.G6 || !window.G6.Graph) {
    emptyBox.style.display = "";
    container.style.display = "none";
    emptyBox.innerHTML =
      '<p class="rg-empty-title">关系图库未加载</p>' +
      '<p class="rg-empty-hint">请检查 vendor/antv-g6 是否正确引入。</p>';
    dialog.showModal();
    return;
  }

  var theme = getThemeColors();

  // G6 数据
  var data = {
    nodes: parsed.nodes.map(function (n, idx) {
      var isProto = /^主角/.test(n.name) || /主角/.test(n.desc || "") || idx === 0;
      return {
        id: n.id,
        data: { label: n.name, isProtagonist: isProto, desc: n.desc || "" }
      };
    }),
    edges: parsed.edges.map(function (e, i) {
      return { id: "e" + i, source: e.from, target: e.to, data: { label: e.label } };
    })
  };

  dialog.showModal();

  // 延迟 250ms 初始化，等待弹窗缩放与位置动画彻底结束，防止 G6 缓存错误的容器 clientOffset 导致移动端触控和拖拽坐标跳跃
  setTimeout(function () {
    if (!dialog.open) return;
    try {
      var Graph = window.G6.Graph;

      destroyGraph();

      var w = container.clientWidth || 400;
      var h = container.clientHeight || 400;

      graphInstance = new Graph({
        container: container,
        width: w,
        height: h,
        autoFit: "view",
        data: data,

        node: {
          type: "rect",
          style: function (d) {
            var proto = d.data && d.data.isProtagonist;
            var label = (d.data && d.data.label) || d.id || "";
            var w = Math.max(56, label.length * 14 + 24);
            return {
              size: [w, 34],
              radius: 17,
              fill: proto ? theme.protoFill : theme.nodeFill,
              stroke: proto ? theme.protoStroke : theme.nodeStroke,
              lineWidth: proto ? 1.8 : 1.2,
              labelText: (d.data && d.data.label) || d.id,
              labelFill: theme.labelFill,
              labelFontSize: 14,
              labelFontWeight: proto ? 600 : 400,
              labelPlacement: "center",
              cursor: "pointer",
              // 徽章
              badges: proto ? [{
                text: "主角",
                placement: "right-top",
                fill: "#fff",
                backgroundFill: theme.activeStroke,
                padding: [1, 6],
                backgroundRadius: 8
              }] : [],
              badgeFontSize: 8,
              // 阴影
              shadowBlur: 6,
              shadowColor: "rgba(0,0,0,0.06)",
              shadowOffsetY: 2,
            };
          },
          state: {
            selected: {
              stroke: theme.activeStroke,
              lineWidth: 2.5,
              shadowBlur: 12,
              shadowColor: "rgba(59,130,246,0.18)"
            },
            active: {
              stroke: theme.activeStroke,
              lineWidth: 2
            },
            inactive: {
              opacity: 0.25
            }
          },
          animation: {
            update: [{ fields: ["x", "y"], duration: 600, easing: "easeInOutCubic" }]
          }
        },

        edge: {
          type: "line",
          style: {
            stroke: theme.edgeStroke,
            lineWidth: 1.2,
            endArrow: true,
            startArrow: function (d) { return d.data && d.data.mutual ? true : false; },
            labelText: function (d) { return d.data && d.data.label ? d.data.label : ""; },
            labelFill: theme.edgeLabelFill,
            labelFontSize: 12,
            labelOffsetY: -6,
            cursor: "default"
          },
          state: {
            active: { stroke: theme.activeStroke, lineWidth: 2, labelFill: theme.activeStroke, labelFontWeight: 500 },
            inactive: { opacity: 0.2 }
          },
          animation: {
            update: [{ fields: ["sourceNode", "targetNode"], duration: 600, easing: "easeInOutCubic" }]
          }
        },

        layout: {
          type: "d3-force",
          animate: true,
          animationIterations: 50,
          iterations: 250,
          link: { 
            distance: function(edge) {
              var txt = edge.data && edge.data.label ? edge.data.label : "";
              return 120 + txt.length * 20;
            },
            strength: 0.25, 
            iterations: 1 
          },
          manyBody: { strength: -500, theta: 0.9 },
          center: { strength: 0.05 },
          collide: { radius: 50, strength: 0.7 },
          alpha: 0.8,
          alphaDecay: 0.018,
          alphaMin: 0.001,
          velocityDecay: 0.4
        },

        behaviors: [
          "drag-canvas",
          {
            type: "zoom-canvas",
            trigger: ["wheel", "pinch"],
            sensitivity: 0.8
          },
          {
            type: "drag-element-force",
            animate: true
          },
          {
            type: "hover-activate",
            degree: 1,
            direction: "both",
            animation: true,
            enable: function (e) { return e.targetType === "node"; }
          },
          {
            type: "click-select",
            degree: 1,
            direction: "both",
            state: "selected"
          }
        ],

        plugins: [
          // Tooltip 悬停提示（节点名称 + 关系数）
          {
            type: "tooltip",
            key: "node-tooltip",
            trigger: "hover",
            position: "top-right",
            offset: [10, 0],
            enable: function (e) { return e.targetType === "node"; },
            getContent: function (evt, items) {
              var item = items[0];
              if (!item || !item.data) return "";
              var proto = item.data.isProtagonist ? ' <span style="color:#3b82f6;font-size:10px;">●主角</span>' : "";
              return '<div style="font-weight:600;color:' + theme.labelFill + ';">' +
                escapeHtml(item.data.label || item.id) + proto + '</div>';
            },
            style: {
              ".tooltip": {
                background: "var(--bg-elevated, #1c1c1e)",
                border: "1px solid var(--glass-border-strong, rgba(255,255,255,0.15))",
                borderRadius: "10px",
                padding: "6px 12px",
                fontSize: "13px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                pointerEvents: "none"
              }
            }
          }
        ]

      });

      graphInstance.render();

      // 绑定容器大小自适应侦听器，同时解决屏幕旋转、键盘弹出或弹窗最终阶段渲染时的画布位置自适应
      if (window.ResizeObserver) {
        graphResizeObserver = new ResizeObserver(function (entries) {
          if (!graphInstance || graphInstance.destroyed) return;
          var entry = entries[0];
          if (entry) {
            var width = entry.contentRect.width;
            var height = entry.contentRect.height;
            if (width > 0 && height > 0) {
              graphInstance.setSize(width, height);
              graphInstance.fitView();
            }
          }
        });
        graphResizeObserver.observe(container);
      }

      // 点击节点 → 显示详情弹窗
      graphInstance.on("node:click", function (evt) {
        showNodeDetailPopup(evt.target.id);
      });

      // 点击画布空白 → 关闭详情
      graphInstance.on("canvas:click", function () {
        hideNodeDetailPopup();
      });

    } catch (err) {
      destroyGraph();
      container.style.display = "none";
      emptyBox.style.display = "";
      emptyBox.innerHTML =
        '<p class="rg-empty-title">关系图渲染失败</p>' +
        '<p class="rg-empty-hint">' + escapeHtmlSafe(err && err.message ? err.message : String(err)) + '</p>';
    }
  }, 250);
}

export function closeRelationGraph() {
  destroyGraph();
  currentParsed = null;
  var dialog = document.getElementById("relationGraphDialog");
  if (dialog && dialog.open) dialog.close();
}

/* ---- 节点详情弹窗（居中浮窗） ---- */

var detailPopup = null;

function createDetailPopup() {
  if (detailPopup) return detailPopup;
  detailPopup = document.createElement("div");
  detailPopup.className = "rg-node-popup";
  detailPopup.hidden = true;
  var container = document.getElementById("relationGraphContainer");
  if (container) container.appendChild(detailPopup);
  return detailPopup;
}

function hideNodeDetailPopup() {
  if (detailPopup) { detailPopup.hidden = true; detailPopup.innerHTML = ""; }
}

function showNodeDetailPopup(nodeId) {
  if (!currentParsed || !graphInstance) return;

  var nodeData = currentParsed.nodes.find(function (n) { return n.id === nodeId; });
  if (!nodeData) return;

  var popup = createDetailPopup();
  var container = document.getElementById("relationGraphContainer");
  if (!container) return;

  var nameToNode = {};
  currentParsed.nodes.forEach(function (n) { nameToNode[n.id] = n; });
  var relations = currentParsed.edges
    .filter(function (e) { return e.from === nodeId || e.to === nodeId; })
    .map(function (e) {
      var otherId = e.from === nodeId ? e.to : e.from;
      var other = nameToNode[otherId];
      return { target: other ? other.label : "?", label: e.label, dir: e.from === nodeId ? "→" : "←" };
    });

  var html = '<div class="rg-popup-header">' +
    '<span class="rg-popup-name">' + escapeHtmlSafe(nodeData.label) + '</span>' +
    '<button class="rg-popup-close" data-action="close-popup" type="button">&#10005;</button>' +
    '</div>';

  if (relations.length) {
    html += '<div class="rg-popup-section">';
    relations.forEach(function (r) {
      html += '<div class="rg-popup-rel-row">' +
        '<span class="rg-popup-rel-label">' + escapeHtmlSafe(r.label) + '</span>' +
        '<span class="rg-popup-rel-dir">' + r.dir + '</span>' +
        '<span class="rg-popup-rel-target">' + escapeHtmlSafe(r.target) + '</span>' +
        '</div>';
    });
    html += '</div>';
  } else {
    html += '<div class="rg-popup-empty">暂无关系连线</div>';
  }

  if (nodeData.desc) {
    html += '<div class="rg-popup-desc">' + escapeHtmlSafe(nodeData.desc) + '</div>';
  }

  popup.innerHTML = html;

  // 居中显示
  var rect = container.getBoundingClientRect();
  popup.style.left = Math.max(12, (rect.width - 260) / 2) + "px";
  popup.style.top = Math.max(12, rect.height * 0.15) + "px";
  popup.hidden = false;

  var closeBtn = popup.querySelector("[data-action='close-popup']");
  if (closeBtn) {
    closeBtn.addEventListener("click", function (e) { e.stopPropagation(); hideNodeDetailPopup(); });
  }
}

function escapeHtmlSafe(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeHtml(s) { return escapeHtmlSafe(s); }
