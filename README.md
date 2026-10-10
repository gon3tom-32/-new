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

## Supabase

The page uses a [Supabase](https://supabase.com) project through the `supabase-js` library loaded from a CDN. It has three features:

- **Shared click counter** — every click of the button, by any visitor, adds to a total shown under it.
- **Guestbook** — visitors leave a name and message; the 50 newest are shown.
- **Logins** — visitors sign in with a link sent to their email. While signed in, the color they pick is saved and restored on their next visit.

A status line at the bottom shows whether the connection to Supabase works.

### Setup

1. In the Supabase dashboard, open **SQL Editor → New query**, paste the contents of [`supabase/setup.sql`](supabase/setup.sql), and click **Run**. This creates the tables and the access rules. It's safe to run again.
2. Under **Authentication → URL Configuration**, set **Site URL** to `https://gon3tom-32.github.io/-new/` and add the same address under **Redirect URLs**, so login links bring people back to the site.

The project URL and publishable key are set in the `<script>` block of `index.html` (`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`). The publishable key is safe to include in the page; Row Level Security policies in `setup.sql` control what visitors can read and write. Never put the secret (`service_role`) key in this repository.

Supabase's built-in email service only sends a few login emails per hour. For real traffic, set up your own email provider under **Authentication → Emails → SMTP Settings**.
