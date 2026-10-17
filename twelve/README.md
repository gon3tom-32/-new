# Twelve

A holiday app for families, friends, and workplace groups: a **gift exchange** and the **12 Days of Games**, in one installable web app (PWA). Each group's host can turn either module on or off.

Once this folder is on the `main` branch, it's live at <https://gon3tom-32.github.io/-new/twelve/>. On a phone, open that link and choose **Add to Home Screen** to install it.

## What's in here

| Path | What it is |
| --- | --- |
| `twelve/` | The app. Plain HTML, CSS, and JavaScript modules, with no build step. GitHub Pages serves it as-is. |
| `twelve/js/config.js` | Supabase project URL, publishable key, and the push key. |
| `twelve/js/screens/` | Onboarding, Home, Leaderboard, Gifts, Chat, Settings, inbox and profile. |
| `twelve/js/games/` | One file per game format, plus `day.js`, which wraps a day (locked, open, played, closed). |
| `twelve/js/vendor/` | Copies of Preact + htm (`htm@3.1.1`) and `@supabase/supabase-js@2.117.2`, so the app doesn't depend on a CDN. |
| `twelve/sw.js` | Service worker: makes the app installable, works offline for the app shell, and shows push notifications. |
| `supabase/twelve.sql` | Tables, access rules, and all the server-side logic (draw, scoring, leaderboards, reminders). |
| `supabase/twelve_content.sql` | The built-in game content. Generated from `supabase/content/packs.json`. |
| `supabase/twelve_push_schedule.sql` | Scheduled jobs for reminders and push. |
| `supabase/functions/twelve-push/` | Edge Function that sends push notifications. |

Everything in the database starts with `twelve_`.

## Setup

### 1. Database (required)

In the Supabase dashboard, open **SQL Editor → New query** and run these files in order:

1. [`supabase/twelve.sql`](../supabase/twelve.sql)
2. [`supabase/twelve_content.sql`](../supabase/twelve_content.sql)

Both are safe to run again. Run them again whenever they change.

### 2. Sign-in (required)

- **Authentication → URL Configuration → Redirect URLs:** add `https://gon3tom-32.github.io/-new/twelve/`.
- **Authentication → Emails:** sign-in is by 6-digit code (the email's link still works as a backup on the same device). Editing the email templates needs custom SMTP (below). In both **Magic link or OTP** and **Confirm sign up**, set:
  - Subject: `Your Twelve code: {{ .Token }}`
  - Body:

    ```html
    <h2>Your Twelve sign-in code</h2>
    <p style="font-size:32px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
    <p>Type this code into Twelve. It works for one hour.</p>
    <p>Or <a href="{{ .ConfirmationURL }}">tap here to sign in</a> on this device.</p>
    ```

  Putting the code in the subject means it shows in the phone's notification, so people often don't need to open the email.
- **Authentication → Providers → Email:** keep **Email OTP Length** at 6. The app signs in automatically when the sixth digit is typed.
- Supabase's built-in email only sends a few messages an hour. Before a real group signs up, set up your own email provider under **Authentication → Emails → SMTP Settings**.

### 3. Reminders (recommended)

Run **Part 1** of [`supabase/twelve_push_schedule.sql`](../supabase/twelve_push_schedule.sql). Every five minutes it creates the scheduled reminders: game unlocks, last calls, questionnaire nudges, and gift countdowns. Without it, those reminders never appear. Notifications sent when something happens (the draw, host changes, anonymous messages) work either way.

### 4. Push notifications (optional)

Reminders always show up under the bell in the app. To also send them to phones:

1. Generate a key pair: `npx web-push generate-vapid-keys`.
2. In **Edge Functions → Secrets**, add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (for example `mailto:you@example.com`), and `TWELVE_PUSH_SECRET` (any long random string).
3. Deploy the function: `supabase functions deploy twelve-push --no-verify-jwt`. The cron job authenticates with `TWELVE_PUSH_SECRET`, not a user login, which is why JWT checks are off.
4. Put the **public** key in `VAPID_PUBLIC_KEY` in `twelve/js/config.js`.
5. Put your `TWELVE_PUSH_SECRET` into **Part 2** of `twelve_push_schedule.sql` and run that part.

People then turn on notifications from the bell → **Push notifications → Turn on**. On iPhone this only works after adding Twelve to the Home Screen (iOS 16.4 or later).

### 5. AI gift ideas (optional, free)

Givers get a **Suggest gift ideas** button under their giftee's answers. It uses Google's Gemini API on its free tier.

1. Create a free API key in [Google AI Studio](https://aistudio.google.com) (**Get API key → Create API key**).
2. In Supabase, open **Edge Functions → Secrets** and add `GEMINI_API_KEY` with that key.
3. Open **Edge Functions → Deploy a new function → Via Editor**, name it `twelve-gift-ideas`, replace the sample code with [`supabase/functions/twelve-gift-ideas/index.ts`](../supabase/functions/twelve-gift-ideas/index.ts), and deploy. Leave JWT verification on.
4. Run `supabase/twelve.sql` again, which adds the daily allowance.

What to know:
- On Google's free tier, Google may use what's sent to improve its products. Only the giftee's questionnaire answers and the budget are sent, never names or emails, and the questionnaire tells people this.
- Each person gets 8 suggestions a day, so a group stays well inside the free limits.
- Google renames models often. The function tries a short list of current low-cost models in order. To pick your own, add a `GEMINI_MODELS` secret, for example `gemini-3.5-flash-lite,gemini-2.5-flash`.

## How it works

### Groups

- The host creates a group and turns on the gift exchange, the games, or both. Each group has a six-character invite code that never changes. Anyone can join any time, from an invite link (`…/twelve/#/join/CODE`) or by typing the code.
- One profile (name and photo) per person, shared across all their groups. You switch groups by tapping the group name at the top.
- The host can rename the group, turn modules on or off, set the time zone, and remove people. A member can leave. The host can't leave; that case was deferred.
- **Seasons:** every yearly thing (exchange, matches, answers, games, chat) belongs to a season. The season is the year and rolls over on **January 16** (UTC), so a New Year's gathering still belongs to the year it finishes. Couples carry over; everything else starts fresh, and past years aren't shown.

### Gift exchange

- Members opt themselves in, and the host can add or remove people, until names are drawn. The host sets a budget guideline and a gathering date and can change them any time. Each change notifies the whole group.
- The host marks couples, then taps **Draw names** when ready. The draw runs in the database: nobody draws themselves, couples never draw each other, everything else is random. Each person gets a private notification and a scratch-off card.
- Each person can only ever read their own match. The roster of participants is visible to everyone.
- The nine-question questionnaire is one question at a time with a progress bar. Only your giver can read your answers.
- **Anonymous Q&A:** givers message their recipient from the match screen. Recipients reply under **Your Secret Santa**. The database never shows a recipient who their giver is.
- **Gift bought** is a private checkbox; nobody else sees it.
- **Reset Secret Santa:** after the draw, the host can undo it and draw again. This deletes every match, the anonymous messages, and the "gift bought" checkmarks, and tells everyone in the exchange. It keeps who's in the exchange, couples, budget, date, and questionnaire answers.

### 12 Days of Games

- The host picks Day 1 (December 1–20, so all twelve days fit in December), an unlock time, and two games to repeat. Unlocks use the group's time zone, so everyone unlocks at the same moment. Each day is open for exactly 24 hours.
- Days 1–11 default to each game once, then the two repeats. The host can rearrange any day that hasn't unlocked yet. Day 12 is always the Finale Quiz, built from questions in that group's own quiz days.
- **Scoring:** every game is worth up to 100 points.

  | Game | Scoring |
  | --- | --- |
  | Trivia, Emoji Decode, Two Truths and a Tradition, Lyric Fill-in-the-Blank, Finale | % correct |
  | Bingo (5×5, free middle) | 3 points a square + 8 points a line. You can keep marking until the day closes. |
  | Scavenger Hunt (6 items) | 10 points an item + up to 40 for speed: the full bonus inside 10 minutes, none after an hour |
  | Speed-Matching (8 pairs) | 70 for accuracy + up to 30 for speed: the full bonus inside 30 seconds, none after 2 minutes |
  | Photo Challenge | 50 for entering, 100 for the host's pick |
  | Would You Rather | 100 for answering them all (no wrong answers) |

- All scoring happens in the database. Answers are never sent to the app before a day closes. For the timed games, the content stays hidden until you press Start, and the clock starts on the server.
- **Playing blind:** after you play, you see who else has played, but no scores. A day's scores and winners appear once it closes. Ties share the crown.
- **The finale:** the host taps **Reveal the champion** when everyone is together. That also closes Day 12. Day 12's scores stay hidden until the reveal, even if the day closes first. The reveal shows the champion (or co-champions) and awards: Daily Crown Collector, Most Consistent Player, Early Bird, and Last-Minute Scrambler.

### Decisions I made that the brief left open

- **Two Truths and a Tradition** uses app-provided sets: three holiday traditions from around the world, one made up. This keeps it self-contained like the other games.
- **Lyric Fill-in-the-Blank** uses traditional, public-domain carols, so there are no licensing issues with modern songs.
- **Would You Rather** gives full points for playing, since there are no wrong answers.
- Quiz-style games are multiple choice, so scoring is fair and automatic.
- After names are drawn, the exchange roster is locked for the year, unless the host resets the draw.

## Editing the game content

Edit `supabase/content/packs.json`, then run:

```sh
node supabase/content/build.mjs
```

This rewrites `supabase/twelve_content.sql`. Run that file in the SQL Editor again. Repeated games use pack 2, so every format that can repeat needs two packs.

## Updating the app

After changing files in `twelve/`, bump `TWELVE_VERSION` near the top of `twelve/index.html` (for example from `"6"` to `"7"`). Every app file loads with that number in its address, so phones fetch the whole new version at once and never mix new files with old cached ones. The service worker takes its version from the same number.

If you add a new JavaScript file under `twelve/js/`, add it to the `modules` list next to `TWELVE_VERSION` too.
