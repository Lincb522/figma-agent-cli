---
name: figma-agent
description: "通过本机 Figma Agent CLI 在已连接的 Figma 文件中设计或修改可编辑 UI、小图标、App Icon、Keyline 构造底板与布尔造型，支持先 image_gen 生图再复刻。用户要求在 Figma 中创建、修改或复刻设计，或明确调用 figma-agent 时使用。"
---

# Figma Agent

Use the local CLI and paired Figma development plugin. This skill supplies the installed tool location and workflow across conversations; the invoking agent performs the design work.

## Install and locate the tool

Run `npm run skill:install` from the cloned repository to install this skill. The installer resolves the paths below for that checkout. If reading this repository copy directly, use the repository root as `{{PROJECT_ROOT}}`.

- Project: `{{PROJECT_ROOT}}`
- CLI: `{{PROJECT_ROOT}}/dist/cli.js`
- Plugin manifest: `{{PROJECT_ROOT}}/dist/plugin/manifest.json`
- Launcher: `{{PROJECT_ROOT}}/Start.command`

The absolute CLI path works from any working directory and uses its own project's state directory. Let the CLI consume its normal credentials; do not read `.figma-agent/session.json`. Do not install another Figma connector or request API keys to use this existing connection.

If the CLI path no longer exists, locate the existing installation within the user's supplied project or ask for its new location. Do not silently create a different installation.

## Begin a task

Read the installed CLI's current guide before the first operation in a conversation:

```sh
node {{CLI_SHELL_PATH}} agent
```

Then run `sessions` and `document`; inspect `selection` when the task refers to selected content. Invoke all commands as `node <absolute-cli-path> <command>`. Use `schema` for command arguments, node properties, and supported operations instead of guessing flags.

Resolve the actual target from the live session and user request. Never reuse a remembered session or node ID. When several files are connected, supply `--session <actual-id>` for every operation targeting a file. Read relevant layers, fonts, styles, and variables before changing an existing design.

## Connect without repeated setup

Preserve a running bridge. If `sessions` reports BRIDGE_NOT_RUNNING or BRIDGE_UNREACHABLE, start `node <absolute-cli-path> serve --quiet` with the available terminal tool and retain its running session. Verify `sessions` again. If the port is already occupied, identify the existing installation instead of stopping it or overwriting its state.

Binding is remembered on this Figma client and reused across files. Reopening the plugin or restarting the bridge restores authorization automatically. Each target file still needs Figma Agent running; files have separate sessions, even when their names match. Never merge or guess sessions by file name. Clearing Figma client storage, changing the plugin ID, or deleting the bridge authorization file requires a new binding.

When no file is connected, ask the user to open Figma Agent in the target file; if the panel says it remembers the device, use its retry button after starting the bridge. Check `sessions` again. For first-time binding, an invalid saved binding, or an explicit request for a code, run `node <absolute-cli-path> pair` yourself and show the returned **one-time six-digit code** with its ten-minute validity. Tell the user to enter it in Figma Agent and click 连接. Do not tell them to restart the terminal to get a code. Only generate another code when the previous one expired or the user requests it.

The user authorizes showing this temporary pairing code to complete binding. This does not authorize reading or displaying persistent credentials: never open `.figma-agent/session.json`, `.figma-agent/authorizations.json`, or dump Figma clientStorage. Let the CLI and plugin handle them normally. A `sessions` response without `persistentPairing: true` means the running bridge predates persistent binding; explain that a one-time bridge restart and plugin reload are needed after updating. Do not stop another task's active bridge without authorization.

After binding, continue the requested design and verify the current document. Keep the bridge process, file, and plugin open. Disconnecting a file keeps the saved binding; 取消此设备绑定 revokes it for every file using that device binding.

## Design workflows

Use the installed `agent` guide as the maintained command reference. Execute the requested design, rather than returning instructions for the user to type commands.

- **UI:** Create and edit native frames, text, components, and layout. Use `apply` for new node trees, `patch` for focused edits, and `exec` for advanced Plugin API work. Preserve the existing file's design language and unrelated content.
- **Icons:** Support both small UI icons and App Icons. The user's Keyline “底板” is a geometry construction grid, distinct from a colored icon background. Keep locked Guides separate from editable Artwork. Use native boolean operands or vector paths for the mark; never consume guide nodes as boolean inputs. Use the guide's `icon`, `boolean`, and clean Artwork export workflow.
- **Image-first reconstruction:** When requested, use `design prepare` and `design generate` to obtain the host `image_gen` request, actually call that tool, inspect its returned image, and accept the actual PNG with its generation receipt. `design generate` alone does not generate an image. Reconstruct native text, controls, layout, and vector/boolean icon shapes; retain raster assets where appropriate. Use `design apply` and `design capture` to produce a real Figma render and comparison. For a supplied image, use `design import`. If the host image tool is unavailable, report that fact rather than presenting a placeholder as generated output.

Save task layouts, scripts, returned node IDs, and exports in a task-specific directory in the current user workspace. Keep reusable CLI source and shipped examples intact during design tasks.

## Verify and recover

After a design mutation, export the affected frames from Figma and inspect the actual images with the available image-viewing tool. Check the requested sizes, layout, text, clipping, and icon geometry; fix observed issues and export again when necessary. For image reconstruction, inspect the live render against the reference. Report actual node IDs, output paths, and any remaining unverified behavior.

An uncertain mutation may already have executed. Preserve its request ID and query `request`; for image reconstruction use `design recover`. Do not retry with a new ID or duplicate a screen just because a reply was lost. Inspect the affected document before deciding the next action.

Reading a document proves the connection and read path only. Do not infer successful native booleans, editable reconstruction, or visual quality from connection status, a local preview, or a test fixture.
