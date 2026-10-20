# Why teal kept appearing

Legacy design used Moroccan “zellij” teal as the **primary** token:

- `--zellij`, `--atlas-accent`, `--btn-primary-bg-solid` = `#0d7377` / `#0f766e`
- Hundreds of rules used those tokens
- Some used `!important`, so new UI still looked green

## Permanent fix

1. Tokens now point to black (`#0a0a0a`), not teal
2. New UI using `var(--zellij)` / `var(--atlas-accent)` is neutral
3. Delete stays red only
