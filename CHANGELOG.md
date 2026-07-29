# Changelog

All notable changes to this project are documented in this file.

## 0.4.0 — 2026-07-30

### Added

- Explorer row backgrounds for local files and recursive folder regions.
- Configurable background opacity and adaptive text watermarks.
- Per-region watermark font family, text color/opacity, outline color/opacity, and outline width.
- Chinese-default editor UI with an in-page Chinese/English language selector.
- Tag-driven Visual Studio Marketplace publishing workflow.

### Notes

- Uses `be5invis.vscode-custom-css` to inject into the built-in Explorer DOM.
- VS Code updates can require reapplying the Custom CSS and JS Loader injection.
