# Color Changer

A simple one-page website with a headline, a short paragraph, and a button that changes the page's background color each time it's clicked.

Everything lives in a single `index.html` file using plain HTML, CSS, and JavaScript — no build step.

Live site: <https://gon3tom-32.github.io/-new/>

## Usage

Open `index.html` directly in any web browser.

Or serve it locally, for example:

```sh
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Customizing

To change the colors the button cycles through, edit the `colors` array in the `<script>` block at the bottom of `index.html`.

## Dark mode

The page follows the device's light or dark setting. The **Dark mode** / **Light mode** button in the top corner overrides it, and the choice is remembered in that browser. In dark mode the chosen background color is dimmed.

## Supabase

The page uses a [Supabase](https://supabase.com) project through the `supabase-js` library loaded from a CDN. It has three features:

- **Shared click counter** — every click of the button, by any visitor, adds to a total shown under it.
- **Guestbook** — visitors leave a name and message; the 50 newest are shown. Messages posted while signed in can be removed by their author with the **Remove** button. Messages posted while signed out have no author and can only be removed from the Supabase dashboard (**Table Editor → guestbook_entries**).
- **Logins** — visitors sign in with a link sent to their email. While signed in, the color they pick is saved and restored on their next visit.
- **Live updates** — the click total and the guestbook update on every open page as soon as anyone clicks, posts, or removes a message, using Supabase Realtime. A note at the bottom of the page says whether live updates are on.

A status line at the bottom shows whether the connection to Supabase works.

### Setup

1. In the Supabase dashboard, open **SQL Editor → New query**, paste the contents of [`supabase/setup.sql`](supabase/setup.sql), and click **Run**. This creates the tables and the access rules. It's safe to run again, and you need to run it again whenever this file changes.
2. Under **Authentication → URL Configuration**, set **Site URL** to `https://gon3tom-32.github.io/-new/` and add the same address under **Redirect URLs**, so login links bring people back to the site.

The project URL and publishable key are set in the `<script>` block of `index.html` (`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`). The publishable key is safe to include in the page; Row Level Security policies in `setup.sql` control what visitors can read and write. Never put the secret (`service_role`) key in this repository.

Supabase's built-in email service only sends a few login emails per hour. For real traffic, set up your own email provider under **Authentication → Emails → SMTP Settings**.
