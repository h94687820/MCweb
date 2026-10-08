---
name: Security scanning availability
description: User's temporary status for external file and image scanning services
---

DeepSeek is not approved for this project and must not be used for image moderation or scanning. New uploads may continue when DeepAI moderation is unavailable or errors, but the user must receive a visible warning that image screening was skipped. A successful DeepAI result that flags an image as unsafe must still block publication. While VirusTotal is under maintenance, its scan status is informational and must not gate downloads for any visitor, including `error` and `malicious` statuses. For the current comprehensive audit, do not attempt to repair, configure, or alter DeepAI, VirusTotal, or scan-error behavior.

**Why:** The user explicitly requested continued publishing with a warning when image moderation fails and public downloads regardless of VirusTotal status while that scanner is under modification. The user also excluded both scanners and scan errors from the current audit.

**How to apply:** Do not substitute DeepSeek for DeepAI. Apply the image-moderation bypass only when service checks fail, surface its reason in the upload UI, and leave successful unsafe-image detections blocked. Do not reintroduce VirusTotal download gating unless the user changes the current maintenance policy; leave both scanner integrations untouched during audits outside their scope.
