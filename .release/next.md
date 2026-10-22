<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

### The first version

DNS Provider Manager keeps A, AAAA and CNAME records in one place and writes them to the DNS
servers that should answer for them. This first version brings the server and its interface:
sign-in with local accounts or OpenID Connect, user management, the activity history,
webhooks and the settings.
