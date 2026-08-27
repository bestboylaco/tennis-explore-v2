# AI Coach navigation and chat-history notes

## Navigation decision

The AI Coach top bar no longer exposes `Platforms` or `About` links. The
existing `/platforms` route and `public/platforms.html` page are intentionally
retained; they have not been deleted and can be restored to navigation later if
stakeholder direction changes.

The left sidebar is now the stable launch point for the organisational tools
currently confirmed by the industry partner:

| Sidebar label | Destination |
|---|---|
| AMS | `https://tennis.smartabase.com/ams/auth` |
| TeamBuildr | `https://app-v3.teambuildr.com/login` |
| Teamworks | `https://login.teamworksapp.com/` |
| TennisMove | `https://www.tennismove.com.au/` |

External tools open in a new tab so the active AI Coach conversation remains in
place. More organisational tools can be added to the same `Connected tools`
section when their URLs are confirmed.

## Chat-history prototype

The chat-history work in this branch is intentionally an interaction prototype,
not long-term account persistence.

The prototype provides:

- a collapsible history area in the existing left sidebar;
- a visible current-conversation state;
- a `New chat` action that moves the completed conversation into history;
- selection of an earlier conversation without leaving the AI Coach workspace;
- an empty state when there are no earlier conversations; and
- temporary preservation of rendered answer details, including citations,
  tables, SQL and grounding warnings, while the page remains open.

Conversation content is held only in browser memory and is cleared when the page
is refreshed or closed. This avoids making an unreviewed persistence decision
for potentially sensitive coaching or athlete information. Server-side history,
retention, account scoping, deletion and privacy rules should be handled in a
separate story before production persistence is introduced.
