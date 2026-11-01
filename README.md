# VICE · Idle Empire

A browser clicker/idle game in the spirit of Clicking Bad. Start with one cannabis plant and climb through twelve product lines to a world-spanning empire. It's a satirical, fictional economy with no real-world information.

## Play

No build step, no installs, no backend. Either:

- Double-click `index.html`, or
- Serve the folder (recommended, so saves are reliable):
  ```
  python -m http.server 8000
  ```
  then open http://localhost:8000

## Put it online

Upload these four files to any static host (GitHub Pages, Netlify, Vercel, itch.io as an HTML game, Cloudflare Pages):

```
index.html  style.css  engine.js  game.js
```

## How it plays

- **Cook & sell.** Click the product (or press Space) to cook batches, then Sell for cash.
- **Cooks and dealers.** Every product line has its own cooks, who make stock, and dealers, who sell it. Keep them balanced. Each hire costs 15% more, and every 25/50/100/150… of a role doubles that role's speed.
- **12 product lines:** Cannabis → Mushrooms → Hashish → LSD → MDMA → Ketamine → Cocaine → Methamphetamine → Opium → Heroin → Nebula → **Dark Matter** (an alien product: ×3 potency, ×3 heat, with its own classified lore file).
- **Heat.** Selling attracts police attention, and harder products run hotter. At 100% you get raided and lose 25% of your cash and half your stock. Fight it with **front businesses** (laundromats up to media empires), heat upgrades, or an emergency **bribe**.
- **78 one-time upgrades.** Four per product line plus global ones. They show up as you grow.
- **Mystery briefcases** pop up on screen: cash, ×7 worker frenzy, ×25 click frenzy, ×3 demand surge, or a wiped police file.
- **Market events:** hot markets (one product ×2 price) and police crackdowns.
- **Rush Hour:** ×2 workers for 30s, every 3 minutes.
- **Legacy (prestige).** Retire for reputation, which gives +2% prices each, forever. Spend it on 13 permanent Connections perks without losing the bonus.
- **53 trophies,** each +1% prices, including one secret.
- Offline earnings (8h, upgradable), autosave, save codes to move between devices, sound effects, and works on phones.

Keys: `Space` cook · `S` sell · `R` rush · `B` bribe · `[` `]` switch product.

## Files

| File | What it is |
|---|---|
| `engine.js` | All game data (products, upgrades, fronts, perks, trophies) and the economy math. No DOM, so Node can test it. |
| `game.js` | Rendering, input, events, briefcases, sound, saving, offline progress. |
| `style.css` | Neon-noir theme; the accent colour follows the selected product. |
| `tests/economy.cjs` | 17 tests for the economy rules: stock never negative, sales capped by stock, one-time upgrades, raids, prestige, save migration. |
| `tests/simulate.cjs` | A bot that plays the game and logs when it reaches each tier. Use it when re-balancing. |

```
node tests/economy.cjs
node tests/simulate.cjs 8 4     # 8 hours of game time, 4 clicks/sec for the first 30 minutes
```

To tune pacing, change `PRICE_STEP` / `COST_STEP` at the top of `engine.js` (how much each product line pays vs. costs relative to the previous one), then re-run the simulator. The current values give a perfect bot the final product at around 7½ hours. Real players take longer, and reputation speeds up later runs.

## Saves

Stored in browser localStorage under `vice-empire-v3`. Saves from the original ChatGPT version (`vice-empire-v1`, schema v2) are converted automatically on first load: cash, lifetime earnings, unlocked products and stock carry over, old staff and upgrades are refunded as cash, and reputation keeps its value. The old save is backed up to `vice-empire-v1-backup`.
