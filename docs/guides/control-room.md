# Control Room

Control Room is a backend-connected operational surface, not a static dashboard.

It provides:

- server-paginated operations and global totals;
- separate ambiguity and reconciliation queues;
- exact transport, receiver and business-effect states;
- attempt history, evidence timeline, signed receipt and review/resolution history;
- declared-scope completeness with missing devices and operations;
- reviewer actions that call role-protected reconciliation and manual-resolution APIs;
- signing-key history, rotation and revocation controls for authorized administrators;
- JSON evidence export.

The UI treats HTTP `403` as an authenticated principal lacking the required role. It never computes global completeness from the currently visible page.
