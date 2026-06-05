# deploy-check

Run a pre-deploy checklist for this project (WhatsApp bot + Vue admin + PostgreSQL).

Check each item and mark it ✅ or ❌:

## 1. Variables de entorno
Read `.env` and verify these keys are present and non-empty:
- `GROQ_API_KEY`
- `DATABASE_URL`
- `PORT` (optional, default 3000)

## 2. Build del admin
Check that `admin/dist/index.html` exists and was modified recently (within the last 24 h relative to the most recent change in `admin/src/`).
If stale or missing, flag it and suggest running `/build-admin`.

## 3. Dependencias
Run `node --eval "require('./src/index.js')" 2>&1 | head -5` — if there's a missing module error, report it.
Actually, just check that `node_modules/` exists and `package.json` dependencies are installed by running `npm ls --depth=0 2>&1 | grep -E "missing|UNMET"`.

## 4. Sintaxis del bot
Run `node --check src/index.js && node --check src/bot.js && node --check src/ai.js && node --check src/db.js` to catch syntax errors without starting the process.

## 5. Git status
Show uncommitted changes (`git status --short`) and how many commits ahead of origin we are (`git rev-list --count origin/main..HEAD 2>/dev/null || echo "no remote"`).

## Output format
Present a clean checklist. For any ❌ item, add one short sentence explaining what to do.
