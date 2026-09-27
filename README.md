# Wingman Tracker

CS2 match tracker hosted on GitHub Pages, with shared data and realtime updates
in Supabase.

Choose **Match format → 2v2 or 3v3** to switch the recording form, combo
leaderboard, player rankings, and match history. Three-player teams are ranked
as full trios. CSV exports include both formats, and imports accept older 2v2
backups as well as files with third-player columns.

## Database setup

Apply `supabase/migrations/20260927000000_add_3v3_players.sql` to an existing
Wingman database before deploying this version. It adds nullable `t1p3` and
`t2p3` fields and requires equal team sizes. Existing rows remain 2v2, and
existing permissions and realtime settings are preserved.

## Local checks

Run `node --test tests/matches.test.cjs` (no dependencies to install).
Serve the folder with `python -m http.server 8765 --bind 127.0.0.1` for a browser
preview. The normal preview uses the live database; test match writes belong
in the mocked automated checks or a database transaction that is rolled back.
