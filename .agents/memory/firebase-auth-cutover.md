---
name: Firebase auth cutover
description: The user's durable decision to use Firebase as the sole authentication provider across the product.
---

Firebase is the sole sign-in provider throughout the product, including Replit preview and Cloudflare production. Remove legacy authentication code and package dependencies rather than leaving a dormant provider in the application.

**Why:** the user explicitly requested complete removal of the previous provider and Firebase as the production authentication system for the whole site.

**How to apply:** Use Firebase ID tokens for all protected API operations, including upload, profile, and settings routes. Do not delete or reassign existing BaaS records or uploaded files as part of auth cleanup.
