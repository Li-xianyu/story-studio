# Third-party vendor assets

This directory contains browser dependencies used by Story Studio:

- `lucide/0.468.0/lucide.min.js`: UI icons
- `vis-network/9.1.9/vis-network.min.js`: force-directed network graph (standalone build, includes vis-data), used by the character relationship graph

Dependencies are served locally to avoid a runtime CDN requirement. When
upgrading a dependency, replace its versioned directory and update references
in the application.
