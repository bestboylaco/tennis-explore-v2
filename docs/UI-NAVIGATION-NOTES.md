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

## Account-scoped chat history

Chat history is now persisted in MongoDB and belongs to the authenticated
account. The browser never supplies an owner id; `/api/conversations` derives
the owner from `req.user.id`, so signing out and later signing back in restores
that account's conversations without exposing another account's history.

The interface provides:

- a collapsible history area in the existing left sidebar;
- a `New chat` action that starts a clean workspace without creating an empty
  database record;
- persisted user and assistant messages, including citations, tables, SQL and
  grounding information;
- selection of an earlier conversation without leaving the AI Coach workspace;
- an active-conversation highlight; and
- an empty state when the signed-in account has no saved conversations.

### Ordering rule

History is ordered by `lastMessageAt` (newest activity first). Selecting or
reading an older conversation does **not** change that timestamp, so clicking a
history item never causes the list to reshuffle. A conversation moves to the
top only after a new message is added to it. Each row also shows its message
count and last-message time so similarly named conversations remain easier to
distinguish.

Retention, deletion and organisation-wide privacy policy can still be expanded
later if the partner requires them; this implementation covers account-scoped
persistence and stable navigation behaviour.
