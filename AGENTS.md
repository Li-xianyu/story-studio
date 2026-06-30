# Workspace-Specific Agent Rules

These rules guide AI coding assistants working in this repository to maintain code consistency and quality.

## General Guidelines
- Do not duplicate helper functions. Check [js/core/utils.js](file:///c:/Users/Lenovo/Desktop/story-studio/js/core/utils.js) first before implementing HTML escaping (`escapeHtml`), JSON parsing (`safeParse` or `tryRepairJson`), or busy/loading states (`setBusy`).
- Use event delegation on `document` or stable container elements instead of query-selecting and adding click listeners to individual elements (e.g. dialog backdrops).
- Keep code ES5-compliant (use `var`, standard anonymous functions) as the project runs directly in the browser using native ES modules without a build step.
