---
trigger: always_on
---

- Use Netlify CLI or MCP server when needed to check deployment of live server, ect. The user does not need to do this manually.
- Use Supabase MCP when database changes or checks need to be made. The user does not need to do this manually.
- Never stub or mock MCP calls.
- Do a git commit after every major change. Do not push until the user instructs you to do so.