# Color Changer

A simple one-page website with a headline, a short paragraph, and a button that changes the page's background color each time it's clicked.

Everything lives in a single `index.html` file using plain HTML, CSS, and JavaScript — no dependencies and no build step.

## Usage

Open `index.html` directly in any web browser.

Or serve it locally, for example:

```sh
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Customizing

To change the colors the button cycles through, edit the `colors` array in the `<script>` block at the bottom of `index.html`.
