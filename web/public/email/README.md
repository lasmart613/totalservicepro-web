# Email static assets

Files here are served from the Next.js `public/` folder. After a production deploy they are reachable as:

`https://repairplanet.net/email/<path>`

Resend HTML must use those absolute HTTPS URLs. Email clients cannot load relative or localhost paths.

## Shop tester invite

`shop-invite/*.jpg` — locked screenshots referenced by `web/lib/shop-invite-email.ts`.

Example: `https://repairplanet.net/email/shop-invite/shot-hero.jpg`

## Clinic blast hero

`laser-clinic-hero-locked.jpg` — locked facial / med-spa hero for clinic-blast Resend HTML.

Production URL (200 after this file is merged and deployed):

`https://repairplanet.net/email/laser-clinic-hero-locked.jpg`

Replace the binary in place (from repo root):

```bash
curl -fsSL -o web/public/email/laser-clinic-hero-locked.jpg '<source-jpg-url>'
```
