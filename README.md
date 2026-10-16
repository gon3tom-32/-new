# Twelve

A holiday app for families, friends, and workplace groups: a gift exchange and the 12 Days of Games, in one installable web app.

Live at <https://gon3tom-32.github.io/-new/twelve/>. The repository's root address (<https://gon3tom-32.github.io/-new/>) redirects there.

- [`twelve/`](twelve/) is the app. See [`twelve/README.md`](twelve/README.md) for how it works and how to set it up.
- [`supabase/`](supabase/) holds the database setup, game content, scheduled jobs, and the push-notification function.

## Removing the old Color Changer data

This repository used to hold a test site called Color Changer. If its tables are still in the Supabase project, run [`supabase/remove_color_changer.sql`](supabase/remove_color_changer.sql) once in the SQL Editor. Then delete the `photos` Storage bucket from the dashboard (**Storage → photos**, delete the files, then delete the bucket).
