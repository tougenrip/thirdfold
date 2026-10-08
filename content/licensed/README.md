# Licensed sources

Licensed content installed on this server goes here: one folder per source, named for its id, with its `source.json` (`thirdfold-licensed-source`) and the content file that names. The game server reads this folder when it starts (`LICENSED_DIR`, default `content/licensed`). See `docs/LICENSED.md` for the format, the terms the server enforces, and how an operator grants, revokes and withdraws a source (`npm run licensed`).

Nothing is installed here by default. `content/licensed-example/` holds a hypothetical source, Example Press's _Clockwork Arsenal_, made up for tests and docs; point `LICENSED_DIR` at it to try the interfaces.

Never put a commercial catalog here without explicit rights and an approved source.
