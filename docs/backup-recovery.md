# Master AI Bot database backups

The Supabase Free plan does not include automatic database backups. This repository includes an owner-triggered and weekly GitHub Actions backup that exports database roles, schema, and data, encrypts the archive with age, and uploads only the encrypted artifact.

## One-time owner setup

1. Generate an age key pair on a trusted device with `age-keygen`.
2. Keep the generated private identity offline in a safe place. Never put it in GitHub.
3. Copy only the public recipient string (starts with `age1`) into GitHub repository Settings → Secrets and variables → Actions as `AGE_BACKUP_RECIPIENT`.
4. In Supabase, copy the Session Pooler connection string from the Connect panel. GitHub-hosted runners use IPv4, so use the Session Pooler rather than the direct IPv6 database hostname.
5. Add that connection string as the GitHub Actions repository secret `SUPABASE_DB_URL`. Do not paste it into chat, code, issues, or workflow logs.
6. Run Actions → Encrypted Supabase backup → Run workflow once and confirm it completes.

## Restore

Download the encrypted artifact from the private GitHub Actions run. On a trusted machine with the private age identity and PostgreSQL client tools:

```sh
age --decrypt --identity /secure/path/age-identity.txt master-ai-supabase-backup.tar.gz.age > master-ai-supabase-backup.tar.gz
tar -xzf master-ai-supabase-backup.tar.gz
```

Review the SQL files before restoring. Restore into a new Supabase project first; do not overwrite the production database until the backup has been validated. Supabase-managed schemas such as Auth and Storage are excluded by the Supabase CLI dump. Storage objects must be backed up separately if the project begins using Supabase Storage.

The workflow keeps encrypted artifacts for 30 days. The private age identity is required to decrypt them. A successful export is not a complete disaster-recovery test; periodically validate restoration in a separate project.
