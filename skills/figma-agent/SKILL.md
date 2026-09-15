---
name: figma-agent
description: "通过本机 Figma Agent CLI 检查连接、启动桥接并按需获取一次性配对码，在 Figma 中设计可编辑 UI、小图标、App Icon、Keyline 构造底板、布尔造型与原型交互动画，支持先 image_gen 生图再复刻，以及导出代码交接包供 Agent 实现参考。用户要求在 Figma 中设计、修改或复刻，把设计转代码或写回项目，连接 Figma Agent，添加点击、悬停、弹层、Smart Animate 或组件状态动画，或明确调用 figma-agent 时使用。"
metadata:
  version: "0.7.1"
---

# Figma Agent

Use the local CLI and paired Figma development plugin. This skill supplies the installed tool location and workflow across conversations; the invoking agent performs the design work.

The host must be able to run the local Node CLI and read/write project files. Load this SKILL.md through the host's supported mechanism; `$figma-agent` is Codex invocation syntax, not a CLI requirement. For hosts without skill discovery, explicitly read this file and run the CLI's `agent` guide. Image generation requires the named tool in the host; supplied reference images can still use `design import` without it.

## Install and locate the tool

The skill includes [scripts/setup.mjs](scripts/setup.mjs). At the beginning of a conversation, run it with Node using its absolute path resolved from this SKILL.md directory:

```sh
node <absolute-skill-directory>/scripts/setup.mjs
```

It downloads the prebuilt CLI and Figma plugin on first use, starts a background bridge when needed, and prints the absolute CLI and manifest paths. A first download also generates a one-time pairing code and Figma import instructions. Node.js 22+, curl, tar and the Figma desktop app are prerequisites; do not claim to install these applications. If Node is missing, guide the user to install it before continuing.

A repository installation records its project path in adjacent `local-install.json` (no credentials). A standalone skill defaults to `~/.local/share/figma-agent-cli`; `FIGMA_AGENT_HOME` or `--project <path>` explicitly selects another location. If a recorded directory exists but is incomplete, repair it instead of overwriting it. Keep using the same installation across conversations. Do not rebuild or download another copy when the current tool is present.

Use the CLI path returned by setup for all subsequent commands. Let the CLI consume its normal credentials; never read `.figma-agent/session.json` or `.figma-agent/authorizations.json`. Do not install another Figma connector or request API keys.

## Begin a task

Read the installed CLI's current guide before the first operation in a conversation:

```sh
node <absolute-cli-path> agent
```

Then run `sessions` and `document`; inspect `selection` when the task refers to selected content. Invoke all commands as `node <absolute-cli-path> <command>`. Use `schema` for command arguments, node properties, and supported operations instead of guessing flags.

Resolve the actual target from the live session and user request. Never reuse a remembered session or node ID. When several files are connected, supply `--session <actual-id>` for every operation targeting a file. Read relevant layers, fonts, styles, and variables before changing an existing design.

## Check the local installation when connecting or updating

Read the built CLI version with `node <absolute-cli-path> --help`. Use 0.6.0 or newer for continuous reconnection; it includes persistent pairing and the embedded-panel startup fix. Read the package version only as source metadata; it does not establish which built CLI or plugin is running.

When the user reports that their local copy is stale, resolve the actual development-plugin directory from their manifest path or Figma process metadata before updating it. Update the installed skill and the local runtime files in that installation, not just a remote repository or ZIP. Preserve `.figma-agent` and the manifest plugin ID so existing bindings survive. Rebuild using that project's normal build command when its sources have changed; a working installation does not need rebuilding for each design task.

Figma's already-open plugin panel keeps running its loaded code. After replacing the plugin files, have the user close and reopen Figma Agent in the target file. Check the displayed panel/main-thread versions in connection diagnostics when available. Do not report a runtime upgrade from a source version or successful build alone. A plugin-only update does not require restarting the bridge. Version 0.6.0 adds prototype-get/prototype-set to the protocol: a bridge started before this update must be restarted once to accept these commands, and the plugin must be reopened. Do not repeatedly retry INVALID_METHOD against that old process. Restart the bridge only when its loaded server code needs updating and that restart is authorized.

If connecting opens a blank panel, stop generating pairing codes. Check the built plugin version and loaded manifest first; 0.4.1 adds startup diagnostics and prevents the pairing form from navigating away when initialization fails. Ask for the first panel diagnostic or console error only if it is needed to continue diagnosis.

## Connect without repeated setup

Preserve a running bridge. If `sessions` reports BRIDGE_NOT_RUNNING or BRIDGE_UNREACHABLE, run the setup helper again; it starts a detached bridge, prints its PID and log path, and verifies readiness. Keep this recovery information and verify `sessions` again. If the port is already occupied, identify the existing installation instead of stopping it or overwriting its state.

Binding is remembered on this Figma client and reused across files. Reopening the plugin or restarting the bridge restores authorization automatically. Each target file still needs Figma Agent running; files have separate sessions, even when their names match. Never merge or guess sessions by file name. Clearing Figma client storage, changing the plugin ID, or deleting the bridge authorization file requires a new binding.

When no file is connected, ask the user to open Figma Agent in the target file. A remembered binding reconnects automatically while the plugin remains open, including after the bridge has been offline for a long time; no new pairing code is needed. Start the bridge if necessary, allow up to 30 seconds for automatic recovery, and check `sessions` again. Use 重试连接 only if the user stopped reconnection or manually disconnected. Preserve an explicit stop until the user requests reconnection. The plugin retains a paused state after recovery, and an uncertain mutation still requires document inspection before continuing. Show the manifest path and guide first-time users through Figma desktop → Plugins → Development → Import plugin from manifest…, then run Figma Agent. Importing the plugin is a manual Figma step; never claim setup performed it. If setup already returned a code, reuse that code. Otherwise, for first-time binding, an invalid saved binding, or an explicit request for a code, run `node <absolute-cli-path> pair` yourself and show the returned **one-time six-digit code** with its ten-minute validity. Tell the user to enter it in Figma Agent and click 连接. Do not tell them to restart the terminal to get a code. Only generate another code when the previous one expired or the user requests it.

The user authorizes showing this temporary pairing code to complete binding. This does not authorize reading or displaying persistent credentials: never open `.figma-agent/session.json`, `.figma-agent/authorizations.json`, or dump Figma clientStorage. Let the CLI and plugin handle them normally. A `sessions` response without `persistentPairing: true` means the running bridge predates persistent binding; explain that a one-time bridge restart and plugin reload are needed after updating. Do not stop another task's active bridge without authorization.

After binding, continue the requested design and verify the current document. Keep the bridge process, file, and plugin open; the setup helper’s background bridge does not require an open terminal. Disconnecting a file keeps the saved binding; 取消此设备绑定 revokes it for every file using that device binding.

## Design workflows

Use the installed `agent` guide as the maintained command reference. Execute the requested design, rather than returning instructions for the user to type commands.

- **UI:** Create and edit native frames, text, components, and layout. Use `apply` for new node trees, `patch` for focused edits, and `exec` for advanced Plugin API work. Preserve the existing file's design language and unrelated content.
- **Interactive animation:** Use `prototype get` to inspect existing reactions, then `prototype set <id> <json>` to replace the node’s Reaction[] while preserving unrelated interactions. `prototype clear` removes all reactions. Use `schema.prototype` for supported triggers/actions, transitions and spring/cubic-bezier easing. Times are seconds, so 300 ms is `0.3`; instant transitions use `null`. Use `actions[]`, never deprecated `action`. For advanced variable/conditional actions outside the dedicated schema, preserve them through native `setReactionsAsync` in `exec` rather than dropping them. Build matching named layers across animation states. For interactive controls, create main component variants in one component set using `figma.combineAsVariants`, connect them with CHANGE_TO, and place an instance in the preview frame. `h.prototype(id, reactions)` is available inside `exec`. Read `<project>/docs/PROTOTYPES.md` and `<project>/examples/interactive-toggle.js` when creating a first interactive component. Select the preview frame and guide the user to Figma Present; verify both forward and return interactions, interruption, and hover/pressed states where applicable. Reading stored reactions and exporting PNGs do not prove animation playback. Do not call a static preview a tested interaction or promise GIF/video export.
- **Icons:** Support both small UI icons and App Icons. The user's Keyline “底板” is a geometry construction grid, distinct from a colored icon background. Keep locked Guides separate from editable Artwork. Use native boolean operands or vector paths for the mark; never consume guide nodes as boolean inputs. Use the guide's `icon`, `boolean`, and clean Artwork export workflow.
- **Image-first reconstruction:** When requested, use `design prepare` and `design generate` to obtain the host `image_gen` request, actually call that tool, inspect its returned image, and accept the actual PNG with its generation receipt. `design generate` alone does not generate an image. Reconstruct native text, controls, layout, and vector/boolean icon shapes; retain raster assets where appropriate. Use `design apply` and `design capture` to produce a real Figma render and comparison. For a supplied image, use `design import`. If the host image tool is unavailable, report that fact rather than presenting a placeholder as generated output.

Save task layouts, scripts, returned node IDs, and exports in a task-specific directory in the current user workspace. Keep reusable CLI source and shipped examples intact during design tasks.

## Hand a completed design back to the agent

After verifying a design or reconstruction, inspect the current project to choose its framework when the task includes code handoff or implementation. Use CLI 0.7.1 or newer for `code export`; this command reuses the existing eval/export bridge protocol and does not require restarting an already compatible bridge. Export the reference into that project:

```sh
node <absolute-cli-path> code export <frame-id> --dir <current-project>/design-reference/<new-name> --format react
```

Omit the node ID only when exactly one intended node is selected. Use `--format html` for SwiftUI and other non-React projects as a portable visual reference, or `react` for React projects and an additional `FigmaDesign.tsx`; both include `index.html`, styles, local assets, native structure, actual Figma preview and `HANDOFF.md`. Pick a new directory for each export; existing source files are never overwritten. The CLI prints absolute paths so the invoking agent task can read the handoff directly, without sending a message to another task.

Read `HANDOFF.md`, `handoff.json` and `design.json`, and view `preview.png` before implementation. Choose the target framework from the current project. For SwiftUI or another framework, generate a matching reference implementation alongside the handoff files using the native structure, assets and project conventions; do not claim the CLI emits those languages. Generated HTML/React uses fixed source dimensions as a visual reference. Preserve auto-layout and constraint metadata when building responsive layouts. Prototype reactions, component properties and variable bindings are reference data, not implemented application behavior. Review the exported warnings, fonts and any flattened assets. Only integrate into application source when implementation is part of the user's request.

## Verify and recover

After a design mutation, export the affected frames from Figma and inspect the actual images with the available image-viewing tool. Check the requested sizes, layout, text, clipping, and icon geometry; fix observed issues and export again when necessary. For image reconstruction, inspect the live render against the reference. Report actual node IDs, output paths, and any remaining unverified behavior.

An uncertain mutation may already have executed. Preserve its request ID and query `request`; for image reconstruction use `design recover`. Do not retry with a new ID or duplicate a screen just because a reply was lost. Inspect the affected document before deciding the next action.

Reading a document proves the connection and read path only. Do not infer successful native booleans, editable reconstruction, or visual quality from connection status, a local preview, or a test fixture.
