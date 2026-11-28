---
name: motion-docs
description: "Look up Motion's API, options and working examples, and find example or Motion UI source to build from. Use when the user asks how a Motion feature works, what options it has, or for an example of an effect, and before writing a non-trivial animation (drag, scroll, gestures, layout, useTransform) from memory."
---

# Motion: docs

This skill is served by the `motion` MCP server, so it is always current.

Read `skill://motion/docs/SKILL.md` from the `motion` MCP server with
resources/read (in Claude Code, with ReadMcpResourceTool) and follow it.
Read every file it names the same way.

If there is no `motion` MCP server, tell the user it is not connected and
point them at https://motion.dev/docs/ai-kit. Running `npx motion-ai`
again sets it up.
