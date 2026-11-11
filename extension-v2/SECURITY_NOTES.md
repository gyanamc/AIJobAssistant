# Profile sharing and revocation

Profile sharing is disabled unless `shareAnonymized` is `true` and the stored
`shareConsentVersion` matches the current consent version. Legacy `true` values
without that version are not treated as explicit consent and users must opt in
again.

Turning sharing off prevents future calls to `/api/v1/profile/sync`. It does not
delete a profile previously synchronized to the backend. The current backend
derives a candidate hash from profile content and has no authenticated proof that
a deletion request comes from the profile owner. Adding an unauthenticated delete
endpoint would allow third parties to remove candidate data.

A secure server-side revocation flow should first establish candidate ownership,
for example through a verified email challenge or an authenticated candidate
account, then bind the resulting identity to the stored candidate record. Only an
authenticated owner-scoped endpoint should delete or deactivate that record and
related recruiter visibility.
