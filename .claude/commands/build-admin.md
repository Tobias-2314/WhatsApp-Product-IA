# build-admin

Build the Vue 3 admin panel and report the result.

Steps:
1. Run `npm run build:admin` from the project root (`/mnt/c/Users/tobia/Documents/WhatsappIA/Whatsapp`).
2. Capture stdout and stderr.
3. If the build succeeds:
   - Report success and show the generated chunks/sizes from Vite output.
   - Mention that `admin/dist/` is updated and the Express server will serve the new build.
4. If the build fails:
   - Show the exact error(s) from the output.
   - Identify the likely cause (TypeScript error, missing import, syntax error, etc.) and suggest a fix.
   - Do NOT silently swallow errors.

Keep the response short: one line of status + the relevant output block.
