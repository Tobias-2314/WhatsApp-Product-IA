# db-status

Check the PostgreSQL database status and show a quick summary of current data.

Steps:
1. Read `/mnt/c/Users/tobia/Documents/WhatsappIA/Whatsapp/.env` to get `DATABASE_URL`.
2. Run the following queries via `psql "$DATABASE_URL" -c` (one call each, run in parallel where possible):
   - `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;` — list tables
   - `SELECT estado, COUNT(*) FROM reservas GROUP BY estado ORDER BY estado;` — reservas by state
   - `SELECT COUNT(*) AS total_mesas, COUNT(*) FILTER (WHERE activa) AS activas FROM mesas;` — mesa summary
   - `SELECT id, nombre, fecha, hora, personas, estado FROM reservas ORDER BY timestamp DESC LIMIT 5;` — last 5 reservations
3. Present the results in a compact, readable format (markdown tables are fine).
4. If `psql` is not available or the connection fails, show the exact error and suggest checking `DATABASE_URL`.
