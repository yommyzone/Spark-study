# Spark Study

Spark Study is a focused study coach with quiz sessions, progress tracking, Supabase authentication, private material uploads and Premium plan foundations.

## Current features

- Supabase email/password authentication
- Password reset
- Biology Spark Session quiz
- Saved session scores and dashboard statistics
- Private PDF, DOCX, TXT and Markdown uploads
- Study Library
- Premium pricing and Paystack Test Mode checkout foundation

## Run locally

This is a static frontend. Serve the folder with any static web server:

```bash
python3 -m http.server 4173
```

The browser-safe configuration is in `supabase-config.js`. Never place a Paystack secret key or Supabase secret/service-role key in this repository.

## Important before live payments

Paystack payment verification must be implemented in a secure Supabase Edge Function before accepting real payments or activating Premium accounts.
