/* ============================================================
   浮光剧场 · 人物关系图 (重制版)
   依赖：AntV G6 5.x (window.G6)
   ============================================================ */

import { escapeHtml } from "../core/utils.js";

var graphInstance = null;
var graphInitTimeoutId = null;
var graphIsRendering = false;
var graphPendingDestroy = false;
var graphResizeObserver = null;
var _graphControls = null;
var _focusedNodeId = null;  // currently focused (clicked) node id
var _hoveredNodeId = null;  // currently hovered node id

/* ---- 主题颜色 ---- */
function getThemeColors() {
  var isLight = document.documentElement.getAttribute("data-theme") === "light";
  if (isLight) {
    return {
      nodeFill: "rgba(0,0,0,0.025)",
      nodeStroke: "rgba(0,122,255,0.35)",
      protoFill: "rgba(0,122,255,0.12)",
      protoStroke: "rgba(0,122,255,0.75)",
      labelFill: "#1c1c1e",
      protoLabelFill: "#003eb0",
      edgeStroke: "rgba(0,0,0,0.25)",
      edgeLabelFill: "#444",
      edgeLabelBg: "rgba(255,255,255,0.92)",
      activeStroke: "#007aff",
      activeShadow: "rgba(0,122,255,0.28)",
      bgColor: "#f2f2f7"
    };
  }
  return {
    nodeFill: "rgba(10,132,255,0.08)",
    nodeStroke: "rgba(10,132,255,0.42)",
    protoFill: "rgba(10,132,255,0.20)",
    protoStroke: "#0a84ff",
    labelFill: "rgba(255,255,255,0.88)",
    protoLabelFill: "#7ecfff",
    edgeStroke: "rgba(255,255,255,0.32)",
    edgeLabelFill: "rgba(255,255,255,0.72)",
    edgeLabelBg: "rgba(14,14,20,0.88)",
    activeStroke: "#0a84ff",
    activeShadow: "rgba(10,132,255,0.38)",
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
      if (Array.isArray(arr)) text = arr;
    } catch (e) {}
  }

  if (Array.isArray(text)) {
    text.forEach(function (item) {
      if (item && item.source && item.target) {
        addEdge(nodeId(item.source, item.relation), nodeId(item.target, item.relation), item.relation || "关联", item.mutual);
      }
    });
    return { nodes: nodes, edges: edges };
  }

  var lines = typeof text === "string" ? text.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
  if (!lines.length) return null;

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

/* ---- 图控件（放大 / 缩小 / 复位） ---- */
function ensureGraphControls(container, graph) {
  if (_graphControls) return;
  _graphControls = document.createElement("div");
  _graphControls.className = "rg-controls";

  function makeBtn(icon, label, onClick) {
    var btn = document.createElement("button");
    btn.className = "rg-ctrl-btn";
    btn.type = "button";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = '<i data-lucide="' + icon + '"></i>';
    btn.addEventListener("click", function (e) { e.stopPropagation(); onClick(); });
    return btn;
  }

  _graphControls.appendChild(makeBtn("zoom-in", "放大", function () {
    if (!graph || graph.destroyed) return;
    try { graph.zoomTo(Math.min((graph.getZoom ? graph.getZoom() : 1) * 1.3, 3), { animation: { duration: 200 } }); } catch (e) {}
  }));
  _graphControls.appendChild(makeBtn("zoom-out", "缩小", function () {
    if (!graph || graph.destroyed) return;
    try { graph.zoomTo(Math.max((graph.getZoom ? graph.getZoom() : 1) * 0.77, 0.3), { animation: { duration: 200 } }); } catch (e) {}
  }));
  _graphControls.appendChild(makeBtn("crosshair", "恢复视角", function () {
    if (!graph || graph.destroyed) return;
    try { graph.fitView(); } catch (e) {}
  }));

  container.appendChild(_graphControls);
  if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}


/* ---- 方向性聚焦：点击/悬停 统一高亮函数 ---- */
function _applyFocus(activeId, graph, parsedData, theme, isClick) {
  if (isClick) {
    _focusedNodeId = activeId;
    _hoveredNodeId = null;
  } else {
    _hoveredNodeId = activeId;
  }

  var states = {};
  
  // Nodes: selected (for click) or active (for hover) for active node, others remain normal
  parsedData.nodes.forEach(function (n) {
    if (n.id === activeId) {
      states[n.id] = [isClick ? "selected" : "active"];
    } else {
      states[n.id] = [];
    }
  });

  try {
    graph.setElementState(states);
    // Force G6 to re-evaluate edge style functions (which now check _focusedNodeId || _hoveredNodeId)
    graph.updateData({
      edges: parsedData.edges.map(function (edge, i) {
        return { id: "e" + i };
      })
    });
    graph.draw();
  } catch (e) {
    console.error("G6 Focus Error:", e);
  }
}

function _applyResetFocus(graph, parsedData, theme) {
  _focusedNodeId = null;
  _hoveredNodeId = null;

  var states = {};
  parsedData.nodes.forEach(function (n) {
    states[n.id] = []; // Clear all states
  });

  try {
    graph.setElementState(states);
    // Force G6 to re-evaluate edge style functions to restore defaults
    graph.updateData({
      edges: parsedData.edges.map(function (edge, i) {
        return { id: "e" + i };
      })
    });
    graph.draw();
  } catch (e) {
    console.error("G6 Reset Error:", e);
  }
}


/* ---- 销毁 ---- */
function destroyGraph() {
  _focusedNodeId = null;
  _hoveredNodeId = null;
  if (graphInitTimeoutId) { clearTimeout(graphInitTimeoutId); graphInitTimeoutId = null; }
  if (graphIsRendering) { graphPendingDestroy = true; return; }
  if (graphResizeObserver) { try { graphResizeObserver.disconnect(); } catch (e) {} graphResizeObserver = null; }
  if (_graphControls) { try { _graphControls.remove(); } catch (e) {} _graphControls = null; }

  if (graphInstance) { try { graphInstance.destroy(); } catch (e) {} graphInstance = null; }
}


/* ---- 打开关系图 ---- */
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
        '<pre class="rg-raw-text">' + escapeHtml(text) + '</pre>';
    }
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    dialog.showModal();
    return;
  }

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
  var nodeCount = parsed.nodes.length;

  var data = {
    nodes: parsed.nodes.map(function (n, idx) {
      var isProto = /^主角/.test(n.name) || /主角/.test(n.desc || "") || idx === 0;
      return { id: n.id, data: { label: n.name, isProtagonist: isProto, desc: n.desc || "" } };
    }),
    edges: parsed.edges.map(function (e, i) {
      return { id: "e" + i, source: e.from, target: e.to, data: { label: e.label, mutual: e.mutual } };
    })
  };

  dialog.showModal();

  if (graphInitTimeoutId) { clearTimeout(graphInitTimeoutId); graphInitTimeoutId = null; }

  // Delay init until dialog animation settles, prevents G6 caching wrong container offset
  graphInitTimeoutId = setTimeout(function () {
    graphInitTimeoutId = null;
    if (!dialog.open) return;
    try {
      var Graph = window.G6.Graph;
      graphIsRendering = false;
      graphPendingDestroy = false;
      if (graphInstance) { try { graphInstance.destroy(); } catch (e) {} graphInstance = null; }

      var w = container.clientWidth || 400;
      var h = container.clientHeight || 400;

      // Use circular layout for small graphs (cleaner), force for larger ones
      var layout = nodeCount <= 6
        ? { type: "circular", radius: Math.min(w, h) * 0.32 }
        : {
            type: "d3-force",
            animate: false,
            iterations: 300,
            link: {
              distance: function (edge) {
                var txt = edge.data && edge.data.label ? edge.data.label : "";
                return 100 + txt.length * 18;
              },
              strength: 0.3,
              iterations: 1
            },
            manyBody: { strength: -Math.max(320, nodeCount * 90), theta: 0.9 },
            center: { strength: 0.08 },
            collide: { radius: 58, strength: 0.8 },
            alpha: 0.8,
            alphaDecay: 0.018,
            alphaMin: 0.001,
            velocityDecay: 0.4
          };

      graphInstance = new Graph({
        container: container,
        width: w,
        height: h,
        autoFit: "view",
        zoomRange: [0.3, 3],
        data: data,

        node: {
          type: "rect",
          style: function (d) {
            var proto = d.data && d.data.isProtagonist;
            var label = (d.data && d.data.label) || d.id || "";
            var nodeW = Math.max(64, label.length * 14 + 28);
            return {
              size: [nodeW, 36],
              radius: 18,
              fill: proto ? theme.protoFill : theme.nodeFill,
              stroke: proto ? theme.protoStroke : theme.nodeStroke,
              lineWidth: proto ? 2.2 : 1.6,
              labelText: label,
              labelFill: proto ? theme.protoLabelFill : theme.labelFill,
              labelFontSize: 13,
              labelFontWeight: proto ? 600 : 450,
              labelFontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif',
              labelPlacement: "center",
              cursor: "pointer"
            };
          },
          state: {
            selected: {
              stroke: theme.activeStroke,
              lineWidth: 2.5,
              shadowBlur: 14,
              shadowColor: theme.activeShadow
            },
            active: {
              stroke: theme.activeStroke,
              lineWidth: 2.5,
              shadowBlur: 14,
              shadowColor: theme.activeShadow
            }
          },
          animation: {
            update: [{ fields: ["x", "y"], duration: 500, easing: "easeInOutCubic" }]
          }
        },

        edge: {
          type: "line",
          style: {
            stroke: function (d) {
              var activeId = _focusedNodeId || _hoveredNodeId;
              if (activeId) {
                var isRelated = d.source === activeId || d.target === activeId;
                return isRelated ? theme.activeStroke : theme.edgeStroke;
              }
              return theme.edgeStroke;
            },
            lineWidth: function (d) {
              var activeId = _focusedNodeId || _hoveredNodeId;
              if (activeId) {
                var isRelated = d.source === activeId || d.target === activeId;
                return isRelated ? 2.4 : 1.6;
              }
              return 1.6;
            },
            endArrow: function (d) {
              var activeId = _focusedNodeId || _hoveredNodeId;
              if (activeId) {
                var isRelated = d.source === activeId || d.target === activeId;
                if (isRelated) {
                  // If it points to the active node, hide it
                  if (d.target === activeId) {
                    return false;
                  }
                  // If it points away from the active node, show it
                  if (d.source === activeId) {
                    return true;
                  }
                }
              }
              return true;
            },
            startArrow: function (d) {
              var isMutual = d.data && d.data.mutual;
              var activeId = _focusedNodeId || _hoveredNodeId;
              if (activeId) {
                var isRelated = d.source === activeId || d.target === activeId;
                if (isRelated) {
                  // If startArrow points to active node, hide it
                  if (d.source === activeId) {
                    return false;
                  }
                  // If it points away from active node, show it (only if mutual)
                  if (d.target === activeId && isMutual) {
                    return true;
                  }
                  return false;
                }
              }
              return isMutual ? true : false;
            },
            labelText: function (d) { return d.data && d.data.label ? d.data.label : ""; },
            labelFill: function (d) {
              var activeId = _focusedNodeId || _hoveredNodeId;
              if (activeId) {
                var isRelated = d.source === activeId || d.target === activeId;
                return isRelated ? theme.activeStroke : theme.edgeLabelFill;
              }
              return theme.edgeLabelFill;
            },
            labelFontSize: 11,
            labelBackground: true,
            labelBackgroundFill: theme.edgeLabelBg,
            labelBackgroundRadius: 4,
            labelPadding: [2, 6],
            cursor: "default"
          }
        },

        layout: layout,

        behaviors: [
          { type: "drag-canvas", enableOptimize: true },
          // Desktop: mouse wheel zoom
          { type: "zoom-canvas", trigger: ["wheel"], sensitivity: 0.8, enableOptimize: true },
          // Mobile: pinch-to-zoom (separate key to avoid conflict)
          { type: "zoom-canvas", key: "zoom-pinch", trigger: ["pinch"], sensitivity: 0.8, enableOptimize: true },
          { type: "drag-element-force", animate: true }
        ]
      });

      ensureGraphControls(container, graphInstance);

      graphIsRendering = true;
      graphInstance.render().then(function () {
        graphIsRendering = false;
        if (graphPendingDestroy) { graphPendingDestroy = false; destroyGraph(); }
      }).catch(function () {
        graphIsRendering = false;
        if (graphPendingDestroy) { graphPendingDestroy = false; destroyGraph(); }
      });

      if (window.ResizeObserver) {
        if (graphResizeObserver) { try { graphResizeObserver.disconnect(); } catch (e) {} graphResizeObserver = null; }
        graphResizeObserver = new ResizeObserver(function (entries) {
          if (!graphInstance || graphInstance.destroyed || graphIsRendering) return;
          var entry = entries[0];
          if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            graphInstance.setSize(entry.contentRect.width, entry.contentRect.height);
          }
        });
        graphResizeObserver.observe(container);
      }

      // ---- Directional focus: click node → show only its outgoing edges ----
      graphInstance.on("click", function (evt) {
        if (evt.targetType === "node") {
          var nodeId = evt.itemId || (evt.target && (evt.target.id || (evt.target.value && evt.target.value.id)));
          if (!nodeId) return;

          if (_focusedNodeId === nodeId) {
            _applyResetFocus(graphInstance, parsed, theme);
          } else {
            _applyFocus(nodeId, graphInstance, parsed, theme, true);
          }
        } else if (evt.targetType === "canvas") {
          if (_focusedNodeId) {
            _applyResetFocus(graphInstance, parsed, theme);
          }
        }
      });

      // Hover events: only trigger if no node is currently clicked/focused
      graphInstance.on("node:pointerenter", function (evt) {
        if (_focusedNodeId) return;
        var nodeId = evt.itemId || (evt.target && (evt.target.id || (evt.target.value && evt.target.value.id)));
        if (nodeId) {
          _applyFocus(nodeId, graphInstance, parsed, theme, false);
        }
      });

      graphInstance.on("node:pointerleave", function () {
        if (_focusedNodeId) return;
        _applyResetFocus(graphInstance, parsed, theme);
      });



    } catch (err) {
      destroyGraph();
      container.style.display = "none";
      emptyBox.style.display = "";
      emptyBox.innerHTML =
        '<p class="rg-empty-title">关系图渲染失败</p>' +
        '<p class="rg-empty-hint">' + escapeHtml(err && err.message ? err.message : String(err)) + '</p>';
    }
  }, 350);
}

export function closeRelationGraph() {
  destroyGraph();
  var dialog = document.getElementById("relationGraphDialog");
  if (dialog && dialog.open) dialog.close();
}

