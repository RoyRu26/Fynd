-- Fynd's market currency becomes Israeli new shekels.
--
-- THIS RELABELS, IT DOES NOT CONVERT. price_amount is untouched: a listing
-- stored as 5000 minor units was EUR 50.00 and is now ILS 50.00, not the
-- shekel equivalent of fifty euro. That is the correct choice here -- these
-- are pre-production fixture rows, and baking an FX rate into a migration
-- would be both wrong the moment it ran and impossible to audit later. If
-- real EUR inventory ever needed converting, that is an application-level
-- backfill with a recorded rate and a recorded timestamp, not DDL.
--
-- Two things deliberately NOT changed:
--
--   * listings_currency_format is CHECK (currency ~ '^[A-Z]{3}$'), which
--     'ILS' already satisfies -- ISO 4217 shape is the only thing that
--     constraint is for, and narrowing it to a single allowed code would
--     just have to be widened again later.
--   * `currency` still has NO client column grant (see the Phase-2
--     allowlist migration). The column default IS the entire mechanism:
--     clients cannot write currency at all, so every new listing gets ILS
--     without the client being trusted to say so.

alter table public.listings alter column currency set default 'ILS';

-- Every existing row. The `where` is not a safety filter so much as a
-- statement of intent: only rows still carrying the old default are
-- relabelled, so re-running this against a mixed-currency table later would
-- not silently rewrite anything that was deliberately set to something else.
--
-- Note this fires listings_set_updated_at, bumping updated_at on the
-- affected rows. Harmless, but "Your listings" orders by updated_at desc,
-- so that list may reshuffle once after this lands.
update public.listings set currency = 'ILS' where currency = 'EUR';
