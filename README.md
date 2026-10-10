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

The page connects to a [Supabase](https://supabase.com) project using the `supabase-js` library loaded from a CDN. A status line under the button shows whether the connection works.

The project URL and publishable key are set near the bottom of `index.html` (`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`). The publishable key is safe to include in the page; protect your data with Row Level Security policies. Never put the secret (`service_role`) key in this repository.

The client is available in the page's script as `window.supabaseClient` for future features.
