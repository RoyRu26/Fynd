#!/usr/bin/env node
/**
 * Fynd local-development seed script.
 *
 * LOCAL DEVELOPMENT ONLY. This script:
 *   - never deletes, truncates, resets, or overwrites unrelated data
 *   - only ever creates or updates its OWN deterministic fixture rows
 *     (identified by stable, derived UUIDs — never by loose fields like
 *     a title string)
 *   - refuses to run against anything that isn't a local Supabase instance
 *   - is safe to re-run any number of times (idempotent upserts throughout)
 *
 * It populates ~9 fictional seller accounts, 3–6 active listings each
 * (clothing + footwear, Hebrew and English titles, ILS prices, varied
 * condition/size, varied creation times), real attached images, and a
 * handful of cross-user favorites — enough for the feed, seller profiles,
 * favorites, and search to all have something meaningful to show.
 *
 * Run with: pnpm seed:dev
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const SEED_PASSWORD = 'FyndSeedDev!2026';
const FIXTURES_DIR = path.join(repoRoot, 'supabase', 'seed', 'fixtures', 'images');

// ============================================================
// Safety guards
// ============================================================

/**
 * Pulls connection info straight from the running local Supabase CLI
 * (`supabase status`) rather than hardcoding any key. This also means the
 * script can never point at the wrong project's local stack — it only ever
 * knows about whatever `supabase` CLI is currently answering for THIS repo.
 */
function getLocalSupabaseConfig() {
  let statusJson;
  try {
    statusJson = execSync('pnpm exec supabase status -o json', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(
      'Could not read local Supabase status. Is the local stack running? ' +
        '(try `pnpm exec supabase start` from the repo root)\n' +
        String(error.stderr ?? error.message ?? error),
    );
  }

  const status = JSON.parse(statusJson);
  const apiUrl = status.API_URL;
  const dbUrl = status.DB_URL;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;

  if (!apiUrl || !dbUrl || !serviceRoleKey) {
    throw new Error('Local Supabase status is missing API_URL, DB_URL, or SERVICE_ROLE_KEY.');
  }

  // Hard refusal: this script holds the service role key and runs
  // unrestricted writes. It must never be pointable at anything but a
  // local loopback instance, under any circumstance.
  const isLocal = (url) => /^(https?|postgres(?:ql)?):\/\/([^@/]*@)?(127\.0\.0\.1|localhost)([:/]|$)/.test(url);
  if (!isLocal(apiUrl) || !isLocal(dbUrl)) {
    throw new Error(
      `Refusing to run: API_URL (${apiUrl}) or DB_URL does not look like a local instance. ` +
        'This script is local-development only.',
    );
  }

  return { apiUrl, dbUrl, serviceRoleKey };
}

// ============================================================
// Deterministic fixture identity
// ============================================================

/**
 * A stable, valid-shaped (version 4, correct variant nibble) UUID derived
 * purely from a human-readable key, with no external uuid dependency and
 * no randomness. The same key always produces the same id, on this machine
 * or any other — that determinism is the entire idempotency mechanism:
 * every insert below targets one of these ids and upserts on conflict,
 * so re-running this script can only ever converge on the same rows, never
 * multiply them.
 */
function seedId(key) {
  const hex = createHash('sha256').update(`fynd-seed:${key}`).digest('hex');
  const p1 = hex.slice(0, 8);
  const p2 = hex.slice(8, 12);
  const p3 = '4' + hex.slice(13, 16);
  const variantNibble = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const p4 = variantNibble + hex.slice(17, 20);
  const p5 = hex.slice(20, 32);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

// ============================================================
// Fixture data
// ============================================================

const USERS = [
  { key: 'maya', email: 'maya@example.test', username: 'maya_cohen', displayName: 'Maya Cohen', bio: "Selling pieces I don't wear anymore 🌿" },
  { key: 'noam', email: 'noam@example.test', username: 'noam_levi', displayName: 'Noam Levi', bio: 'Sneakerhead, always rotating my collection' },
  { key: 'tamar', email: 'tamar@example.test', username: 'tamar_shani', displayName: 'Tamar Shani', bio: 'Vintage finds and the occasional closet clear-out' },
  { key: 'eitan', email: 'eitan@example.test', username: 'eitan_barak', displayName: 'Eitan Barak', bio: 'Minimal wardrobe, maximum quality' },
  { key: 'shira', email: 'shira@example.test', username: 'shira_golan', displayName: 'Shira Golan', bio: 'Clearing out my closet, one listing at a time' },
  { key: 'yossi', email: 'yossi@example.test', username: 'yossi_mizrahi', displayName: 'Yossi Mizrahi', bio: null },
  { key: 'noa', email: 'noa@example.test', username: 'noa_peretz', displayName: 'Noa Peretz', bio: 'TLV based, usually meet near the beach' },
  { key: 'daniel', email: 'daniel@example.test', username: 'daniel_avraham', displayName: 'Daniel Avraham', bio: 'Streetwear and sneakers only' },
  { key: 'michal', email: 'michal@example.test', username: 'michal_bendavid', displayName: 'Michal Ben-David', bio: 'Decluttering, one piece at a time' },
];

// Leaf category ids seeded by this repo's categories migration
// (supabase/migrations/20261018100200_categories.sql) — fixed literal
// UUIDs baked into that migration, so they are stable across any fresh
// apply of it, not just on this one running instance. Verified live
// against this database before being hardcoded here (see the seed
// script's own startup check below, which re-verifies every one of these
// still resolves to a real row before writing anything).
const CATEGORIES = {
  womenTops: 'c0000001-0000-4000-8000-000000000001',
  womenDresses: 'c0000001-0000-4000-8000-000000000002',
  womenBottoms: 'c0000001-0000-4000-8000-000000000003',
  womenOuterwear: 'c0000001-0000-4000-8000-000000000004',
  womenShoes: 'c0000001-0000-4000-8000-000000000005',
  womenBags: 'c0000001-0000-4000-8000-000000000006',
  womenAccessories: 'c0000001-0000-4000-8000-000000000007',
  menTops: 'c0000002-0000-4000-8000-000000000001',
  menBottoms: 'c0000002-0000-4000-8000-000000000002',
  menOuterwear: 'c0000002-0000-4000-8000-000000000003',
  menShoes: 'c0000002-0000-4000-8000-000000000004',
  menAccessories: 'c0000002-0000-4000-8000-000000000005',
};

const CLOSING_PHRASES = [
  'Smoke-free home.',
  'Pet-free home.',
  'Happy to meet in Tel Aviv or ship.',
  'Selling because it no longer fits.',
  'Barely worn, moving on to new styles.',
];

function describe(title, conditionLabel, index) {
  const closing = CLOSING_PHRASES[index % CLOSING_PHRASES.length];
  return `${title}. Gently used, ${conditionLabel} condition. ${closing}`;
}

const CONDITION_LABELS = {
  new: 'new',
  like_new: 'like new',
  very_good: 'very good',
  good: 'good',
  fair: 'fair',
};

// [userKey, title, priceILS, condition, size, categoryKey, imageColor]
const LISTING_TEMPLATES = [
  ['maya', "מעיל ג'ינס קלאסי", 120, 'good', 'alpha_m', 'womenOuterwear', 'denim'],
  ['maya', 'Floral Summer Dress', 90, 'very_good', 'alpha_s', 'womenDresses', 'rose'],
  ['maya', "תיק עור חום וינטג'", 150, 'good', 'one_size', 'womenBags', 'tan'],
  ['maya', 'סוודר צמר אפור', 70, 'fair', 'alpha_m', 'womenTops', 'charcoal'],
  ['maya', 'White Linen Blouse', 55, 'like_new', 'alpha_s', 'womenTops', 'cream'],

  ['noam', 'White Leather Sneakers', 220, 'very_good', 'eu_shoe_42', 'menShoes', 'cream'],
  ['noam', 'נעלי ריצה שחורות', 180, 'good', 'eu_shoe_43', 'menShoes', 'black'],
  ['noam', 'Navy Track Jacket', 95, 'good', 'alpha_l', 'menOuterwear', 'navy'],
  ['noam', 'מכנסי טרנינג אפורים', 60, 'like_new', 'alpha_m', 'menBottoms', 'charcoal'],

  ['tamar', 'Vintage Leather Jacket', 280, 'good', 'alpha_m', 'womenOuterwear', 'black'],
  ['tamar', 'שמלת קוקטייל שחורה', 110, 'very_good', 'alpha_s', 'womenDresses', 'black'],
  ['tamar', 'Tan Ankle Boots', 160, 'good', 'eu_shoe_38', 'womenShoes', 'tan'],
  ['tamar', "צעיף משי וינטג'", 40, 'fair', 'one_size', 'womenAccessories', 'rose'],
  ['tamar', 'Olive Cargo Pants', 85, 'very_good', 'alpha_m', 'womenBottoms', 'olive'],

  ['eitan', 'Charcoal Wool Coat', 320, 'like_new', 'alpha_l', 'menOuterwear', 'charcoal'],
  ['eitan', 'חולצת פולו כחולה', 50, 'very_good', 'alpha_m', 'menTops', 'navy'],
  ['eitan', 'Black Chelsea Boots', 240, 'new', 'eu_shoe_44', 'menShoes', 'black'],

  ['shira', 'Floral Maxi Dress', 100, 'good', 'alpha_m', 'womenDresses', 'rose'],
  ['shira', 'מעיל גשם', 75, 'good', 'alpha_s', 'womenOuterwear', 'navy'],
  ['shira', 'Striped Cotton Top', 45, 'very_good', 'alpha_m', 'womenTops', 'cream'],
  ['shira', 'נעלי בלרינה שחורות', 80, 'good', 'eu_shoe_37', 'womenShoes', 'black'],
  ['shira', 'Beige Tote Bag', 65, 'like_new', 'one_size', 'womenBags', 'tan'],
  ['shira', 'מכנסי ג׳ינס כחולים', 70, 'good', 'alpha_m', 'womenBottoms', 'denim'],

  ['yossi', 'Grey Hoodie', 60, 'good', 'alpha_l', 'menTops', 'charcoal'],
  ['yossi', 'נעלי סקייט שחורות', 140, 'very_good', 'eu_shoe_41', 'menShoes', 'black'],
  ['yossi', 'Denim Jacket', 130, 'good', 'alpha_m', 'menOuterwear', 'denim'],
  ['yossi', 'כפכפי עור חומים', 55, 'fair', 'eu_shoe_42', 'menShoes', 'tan'],

  ['noa', 'Linen Summer Shirt', 50, 'very_good', 'alpha_s', 'womenTops', 'cream'],
  ['noa', 'שמלת בוהו ארוכה', 95, 'good', 'alpha_m', 'womenDresses', 'olive'],
  ['noa', 'Woven Straw Bag', 45, 'like_new', 'one_size', 'womenBags', 'tan'],
  ['noa', 'סנדלי עור שטוחים', 70, 'good', 'eu_shoe_38', 'womenShoes', 'tan'],

  ['daniel', 'Black Cargo Pants', 90, 'very_good', 'alpha_l', 'menBottoms', 'black'],
  ['daniel', 'נעלי קנבס לבנות', 110, 'good', 'eu_shoe_43', 'menShoes', 'cream'],
  ['daniel', 'Oversized Hoodie', 75, 'like_new', 'alpha_xl', 'menTops', 'charcoal'],
  ['daniel', 'מעיל בומבר שחור', 150, 'very_good', 'alpha_m', 'menOuterwear', 'black'],
  ['daniel', 'Navy Beanie', 25, 'good', 'one_size', 'menAccessories', 'navy'],

  ['michal', 'חצאית טוויד', 65, 'good', 'alpha_s', 'womenBottoms', 'tan'],
  ['michal', 'Cream Silk Blouse', 60, 'very_good', 'alpha_m', 'womenTops', 'cream'],
  ['michal', 'נעלי עקב שחורות', 85, 'good', 'eu_shoe_39', 'womenShoes', 'black'],
  ['michal', 'Olive Utility Jacket', 130, 'very_good', 'alpha_l', 'womenOuterwear', 'olive'],
];

// Structured attributes per seed listing (AI listing metadata plan, Phase
// 1a), keyed like `listingKey` (`${userKey}:${title}`). Slugs are resolved
// against listing_attribute_terms at startup — an unknown slug fails the run
// before anything is written — and every value must fit the listing's
// category (the database's own validate trigger re-checks this on insert).
// `fit` only on clothing leaves; shoes, bags and accessories have none.
// Keywords follow listing_keywords_valid(): no geresh/apostrophes.
//
// Shape: { type, colors, material, style, pattern, fit, kw }; null = unset.
const LISTING_ATTRIBUTES = {
  "maya:מעיל ג'ינס קלאסי": { type: 'jacket', colors: ['blue'], material: 'denim', style: 'vintage', pattern: 'solid', fit: 'regular', kw: ['denim jacket', 'classic'] },
  'maya:Floral Summer Dress': { type: 'dress', colors: ['pink', 'white'], material: 'cotton', style: 'boho', pattern: 'floral', fit: 'relaxed', kw: ['summer', 'midi'] },
  "maya:תיק עור חום וינטג'": { type: 'bag', colors: ['brown'], material: 'leather', style: 'vintage', pattern: 'solid', fit: null, kw: ['crossbody'] },
  'maya:סוודר צמר אפור': { type: 'sweater', colors: ['grey'], material: 'wool', style: 'minimal', pattern: 'solid', fit: 'relaxed', kw: ['knit', 'סריג'] },
  'maya:White Linen Blouse': { type: 'blouse', colors: ['white'], material: 'linen', style: 'minimal', pattern: 'solid', fit: 'regular', kw: ['summer'] },

  'noam:White Leather Sneakers': { type: 'sneakers', colors: ['white'], material: 'leather', style: 'minimal', pattern: 'solid', fit: null, kw: ['low top'] },
  'noam:נעלי ריצה שחורות': { type: 'sneakers', colors: ['black'], material: 'synthetic', style: 'sportswear', pattern: 'solid', fit: null, kw: ['running', 'ריצה'] },
  'noam:Navy Track Jacket': { type: 'jacket', colors: ['navy'], material: 'synthetic', style: 'sportswear', pattern: 'striped', fit: 'regular', kw: ['track top', 'zip up'] },
  'noam:מכנסי טרנינג אפורים': { type: 'joggers', colors: ['grey'], material: 'cotton', style: 'sportswear', pattern: 'solid', fit: 'relaxed', kw: ['טרנינג', 'sweatpants'] },

  'tamar:Vintage Leather Jacket': { type: 'jacket', colors: ['black'], material: 'leather', style: 'vintage', pattern: 'solid', fit: 'regular', kw: ['biker', 'moto'] },
  'tamar:שמלת קוקטייל שחורה': { type: 'dress', colors: ['black'], material: 'synthetic', style: 'formal', pattern: 'solid', fit: 'slim', kw: ['cocktail', 'ערב'] },
  'tamar:Tan Ankle Boots': { type: 'boots', colors: ['brown'], material: 'leather', style: 'vintage', pattern: 'solid', fit: null, kw: ['ankle boots'] },
  "tamar:צעיף משי וינטג'": { type: 'scarf', colors: ['pink'], material: 'silk', style: 'vintage', pattern: 'floral', fit: null, kw: ['silk scarf'] },
  'tamar:Olive Cargo Pants': { type: 'trousers', colors: ['khaki'], material: 'cotton', style: 'workwear', pattern: 'solid', fit: 'relaxed', kw: ['cargo', 'utility'] },

  'eitan:Charcoal Wool Coat': { type: 'coat', colors: ['grey'], material: 'wool', style: 'minimal', pattern: 'solid', fit: 'regular', kw: ['overcoat'] },
  'eitan:חולצת פולו כחולה': { type: 'polo', colors: ['navy'], material: 'cotton', style: 'preppy', pattern: 'solid', fit: 'regular', kw: ['פולו'] },
  'eitan:Black Chelsea Boots': { type: 'boots', colors: ['black'], material: 'leather', style: 'minimal', pattern: 'solid', fit: null, kw: ['chelsea'] },

  'shira:Floral Maxi Dress': { type: 'dress', colors: ['pink', 'green'], material: 'cotton', style: 'boho', pattern: 'floral', fit: 'relaxed', kw: ['maxi', 'summer'] },
  'shira:מעיל גשם': { type: 'jacket', colors: ['navy'], material: 'synthetic', style: 'minimal', pattern: 'solid', fit: 'regular', kw: ['raincoat', 'גשם'] },
  'shira:Striped Cotton Top': { type: 't_shirt', colors: ['white', 'navy'], material: 'cotton', style: 'preppy', pattern: 'striped', fit: 'regular', kw: ['breton'] },
  'shira:נעלי בלרינה שחורות': { type: 'flats', colors: ['black'], material: 'leather', style: 'minimal', pattern: 'solid', fit: null, kw: ['ballet flats', 'בלרינה'] },
  'shira:Beige Tote Bag': { type: 'bag', colors: ['beige'], material: 'cotton', style: 'minimal', pattern: 'solid', fit: null, kw: ['tote'] },
  'shira:מכנסי ג׳ינס כחולים': { type: 'jeans', colors: ['blue'], material: 'denim', style: null, pattern: 'solid', fit: 'regular', kw: ['jeans'] },

  'yossi:Grey Hoodie': { type: 'hoodie', colors: ['grey'], material: 'cotton', style: 'streetwear', pattern: 'solid', fit: 'regular', kw: ['pullover'] },
  'yossi:נעלי סקייט שחורות': { type: 'sneakers', colors: ['black'], material: null, style: 'streetwear', pattern: 'solid', fit: null, kw: ['skate', 'סקייט'] },
  'yossi:Denim Jacket': { type: 'jacket', colors: ['blue'], material: 'denim', style: 'vintage', pattern: 'solid', fit: 'regular', kw: ['trucker'] },
  'yossi:כפכפי עור חומים': { type: 'sandals', colors: ['brown'], material: 'leather', style: null, pattern: 'solid', fit: null, kw: ['slides', 'כפכפים'] },

  'noa:Linen Summer Shirt': { type: 'shirt', colors: ['cream'], material: 'linen', style: 'minimal', pattern: 'solid', fit: 'relaxed', kw: ['summer'] },
  'noa:שמלת בוהו ארוכה': { type: 'dress', colors: ['green'], material: 'cotton', style: 'boho', pattern: 'solid', fit: 'relaxed', kw: ['maxi', 'בוהו'] },
  'noa:Woven Straw Bag': { type: 'bag', colors: ['beige'], material: null, style: 'boho', pattern: null, fit: null, kw: ['straw', 'beach'] },
  'noa:סנדלי עור שטוחים': { type: 'sandals', colors: ['brown'], material: 'leather', style: 'boho', pattern: 'solid', fit: null, kw: ['flat sandals'] },

  'daniel:Black Cargo Pants': { type: 'trousers', colors: ['black'], material: 'cotton', style: 'streetwear', pattern: 'solid', fit: 'relaxed', kw: ['cargo'] },
  'daniel:נעלי קנבס לבנות': { type: 'sneakers', colors: ['white'], material: 'cotton', style: 'minimal', pattern: 'solid', fit: null, kw: ['canvas', 'קנבס'] },
  'daniel:Oversized Hoodie': { type: 'hoodie', colors: ['grey'], material: 'cotton', style: 'streetwear', pattern: 'solid', fit: 'oversized', kw: ['pullover'] },
  'daniel:מעיל בומבר שחור': { type: 'jacket', colors: ['black'], material: 'synthetic', style: 'streetwear', pattern: 'solid', fit: 'regular', kw: ['bomber', 'בומבר'] },
  'daniel:Navy Beanie': { type: 'hat', colors: ['navy'], material: 'wool', style: 'streetwear', pattern: 'solid', fit: null, kw: ['beanie'] },

  'michal:חצאית טוויד': { type: 'skirt', colors: ['beige', 'brown'], material: 'wool', style: 'preppy', pattern: 'checked', fit: 'regular', kw: ['tweed', 'טוויד'] },
  'michal:Cream Silk Blouse': { type: 'blouse', colors: ['cream'], material: 'silk', style: 'formal', pattern: 'solid', fit: 'regular', kw: ['office'] },
  'michal:נעלי עקב שחורות': { type: 'heels', colors: ['black'], material: 'leather', style: 'formal', pattern: 'solid', fit: null, kw: ['pumps', 'עקבים'] },
  'michal:Olive Utility Jacket': { type: 'jacket', colors: ['khaki'], material: 'cotton', style: 'workwear', pattern: 'solid', fit: 'relaxed', kw: ['utility', 'field jacket'] },
};

// Brands for some seed listings (AI listing metadata plan, Phase 1b), keyed
// like LISTING_ATTRIBUTES. `brand` is a catalog key (brands.key) and fails the
// run before anything is written if it doesn't exist; `text` is a custom
// brand_text for a brand that isn't in the catalog. Exactly one per entry.
// Listings not listed here stay brand-less on purpose, like real listings.
const LISTING_BRANDS = {
  'noam:White Leather Sneakers': { brand: 'adidas' },
  'noam:נעלי ריצה שחורות': { brand: 'nike' },
  'noam:Navy Track Jacket': { brand: 'fila' },
  'noam:מכנסי טרנינג אפורים': { brand: 'champion' },
  'tamar:Vintage Leather Jacket': { text: 'Vintage Biker Co' },
  'tamar:Tan Ankle Boots': { brand: 'dr martens' },
  'tamar:Olive Cargo Pants': { brand: 'zara' },
  'eitan:Charcoal Wool Coat': { brand: 'cos' },
  'eitan:חולצת פולו כחולה': { brand: 'lacoste' },
  'eitan:Black Chelsea Boots': { brand: 'clarks' },
  'shira:Floral Maxi Dress': { brand: 'mango' },
  'shira:מכנסי ג׳ינס כחולים': { brand: 'levis' },
  "maya:תיק עור חום וינטג'": { text: 'Local Leather Workshop' },
  'yossi:Grey Hoodie': { brand: 'carhartt wip' },
  'yossi:Denim Jacket': { brand: 'carhartt' },
  'noa:Woven Straw Bag': { text: 'Handmade in Jaffa' },
  'daniel:Oversized Hoodie': { brand: 'stussy' },
  'daniel:נעלי קנבס לבנות': { brand: 'converse' },
  'daniel:Black Cargo Pants': { brand: 'dickies' },
  'michal:Cream Silk Blouse': { brand: 'massimo dutti' },
  'michal:נעלי עקב שחורות': { brand: 'steve madden' },
};

/** [{ kind, slug }] in the order they're stored: per-kind position = array order. */
function attributeSlugs(spec) {
  const one = (kind, slug) => (slug ? [{ kind, slug }] : []);
  return [
    ...one('item_type', spec.type),
    ...spec.colors.map((slug) => ({ kind: 'color', slug })),
    ...one('style', spec.style),
    ...one('material', spec.material),
    ...one('pattern', spec.pattern),
    ...one('fit', spec.fit),
  ];
}

// Fixed anchor, not `Date.now()` — every run must compute the exact same
// timestamps, or a re-run would drift createdAt on every listing and this
// would no longer be idempotent in any meaningful sense.
const CREATED_AT_BASE = new Date('2026-09-15T09:00:00Z').getTime();
const HOURS_BETWEEN_LISTINGS = 7;

function createdAtFor(globalIndex) {
  return new Date(CREATED_AT_BASE + globalIndex * HOURS_BETWEEN_LISTINGS * 60 * 60 * 1000).toISOString();
}

// Each listing gets two images: its own color, plus a neutral second shot.
function imageColorsFor(primaryColor) {
  const secondary = primaryColor === 'cream' ? 'tan' : 'cream';
  return [primaryColor, secondary];
}

// Deterministic, non-self cross-favorites: user[i] favorites one listing
// each from user[i+1] and user[i+3] (mod user count) — offsets of 1 and 3
// are never 0 for a 9-user list, so no user ever favorites their own item.
function buildFavoritePlan(users, listingsByUser) {
  const plan = [];
  users.forEach((user, i) => {
    [1, 3].forEach((offset) => {
      const targetUser = users[(i + offset) % users.length];
      const targetListings = listingsByUser.get(targetUser.key);
      if (targetListings && targetListings.length > 0) {
        const listing = targetListings[i % targetListings.length];
        plan.push({ userKey: user.key, listingKey: listing.key });
      }
    });
  });
  return plan;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const { apiUrl, dbUrl, serviceRoleKey } = getLocalSupabaseConfig();
  console.log(`Seeding local Supabase at ${apiUrl} ...`);

  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();

  try {
    // ---- startup sanity check: every category id this script relies on
    // must actually exist, or fail loudly now rather than inserting a
    // listing with a dangling category_id later. ----
    const categoryIds = Object.values(CATEGORIES);
    const { rows: foundCategories } = await db.query(
      'select id from public.categories where id = any($1::uuid[])',
      [categoryIds],
    );
    if (foundCategories.length !== categoryIds.length) {
      throw new Error(
        `Expected ${categoryIds.length} category fixture ids to exist, found ${foundCategories.length}. ` +
          'Has the categories migration been applied to this database?',
      );
    }

    // ---- startup sanity check: every attribute slug must resolve to an
    // active term, and every listing template must have an attribute entry
    // (and vice versa). Fails before any write. ----
    const { rows: termRows } = await db.query(
      'select id, kind, slug from public.listing_attribute_terms where retired_at is null',
    );
    const termIdBySlug = new Map(termRows.map((row) => [`${row.kind}:${row.slug}`, row.id]));
    const templateKeys = new Set(LISTING_TEMPLATES.map(([userKey, title]) => `${userKey}:${title}`));
    for (const key of templateKeys) {
      if (!LISTING_ATTRIBUTES[key]) throw new Error(`No LISTING_ATTRIBUTES entry for seed listing "${key}"`);
    }
    for (const [key, spec] of Object.entries(LISTING_ATTRIBUTES)) {
      if (!templateKeys.has(key)) throw new Error(`LISTING_ATTRIBUTES entry "${key}" matches no seed listing`);
      for (const { kind, slug } of attributeSlugs(spec)) {
        if (!termIdBySlug.has(`${kind}:${slug}`)) {
          throw new Error(`Unknown or retired ${kind} slug "${slug}" for seed listing "${key}"`);
        }
      }
    }

    // ---- startup sanity check for brands: every catalog key must exist and
    // every entry must match a seed listing. Fails before any write. ----
    const { rows: brandRows } = await db.query('select id, key from public.brands');
    const brandIdByKey = new Map(brandRows.map((row) => [row.key, row.id]));
    for (const [key, spec] of Object.entries(LISTING_BRANDS)) {
      if (!templateKeys.has(key)) throw new Error(`LISTING_BRANDS entry "${key}" matches no seed listing`);
      if (Boolean(spec.brand) === Boolean(spec.text)) {
        throw new Error(`LISTING_BRANDS entry "${key}" must have exactly one of brand / text`);
      }
      if (spec.brand && !brandIdByKey.has(spec.brand)) {
        throw new Error(`Unknown brand key "${spec.brand}" for seed listing "${key}"`);
      }
    }

    // Snapshot counts BEFORE, to report alongside AFTER at the end — the
    // whole point is proving nothing unrelated moved.
    const before = await snapshotCounts(db);

    // ---- users + profiles ----
    const userIdByKey = new Map();
    for (const user of USERS) {
      const userId = await ensureAuthUser(admin, db, user);
      userIdByKey.set(user.key, userId);
      await upsertProfile(db, userId, user);
    }
    console.log(`Users ready: ${USERS.length}`);

    // ---- listings + images ----
    const listingsByUser = new Map();
    let imageCount = 0;
    let listingIndex = 0;
    for (const [userKey, title, priceILS, condition, size, categoryKey, color] of LISTING_TEMPLATES) {
      const sellerId = userIdByKey.get(userKey);
      const listingKey = `${userKey}:${title}`;
      const listingId = seedId(`listing:${listingKey}`);
      const createdAt = createdAtFor(listingIndex);
      const description = describe(title, CONDITION_LABELS[condition], listingIndex);

      await upsertListing(db, {
        id: listingId,
        sellerId,
        title,
        description,
        priceAmount: priceILS * 100,
        condition,
        size,
        categoryId: CATEGORIES[categoryKey],
        createdAt,
      });

      if (!listingsByUser.has(userKey)) listingsByUser.set(userKey, []);
      listingsByUser.get(userKey).push({ key: listingKey, id: listingId });

      const colors = imageColorsFor(color);
      for (let position = 0; position < colors.length; position += 1) {
        await ensureListingImage(admin, db, {
          sellerId,
          listingId,
          position,
          color: colors[position],
          imageKey: `image:${listingKey}:${position}`,
        });
        imageCount += 1;
      }

      listingIndex += 1;
    }
    console.log(`Listings ready: ${listingIndex}, images ready: ${imageCount}`);

    // ---- favorites ----
    const favoritePlan = buildFavoritePlan(USERS, listingsByUser);
    let favoriteCount = 0;
    for (const { userKey, listingKey } of favoritePlan) {
      const userId = userIdByKey.get(userKey);
      const listing = [...listingsByUser.values()].flat().find((l) => l.key === listingKey);
      if (!listing) continue;
      await db.query(
        `insert into public.favorites (user_id, listing_id)
         values ($1, $2)
         on conflict (user_id, listing_id) do nothing`,
        [userId, listing.id],
      );
      favoriteCount += 1;
    }
    console.log(`Favorites ready: ${favoriteCount}`);

    // ---- brands ----
    let brandedCount = 0;
    for (const listing of [...listingsByUser.values()].flat()) {
      const spec = LISTING_BRANDS[listing.key];
      if (!spec) continue;
      if (await ensureListingBrand(db, listing.id, spec.brand ? brandIdByKey.get(spec.brand) : null, spec.text ?? null)) {
        brandedCount += 1;
      }
    }
    console.log(
      `Brands: ${brandedCount} of ${Object.keys(LISTING_BRANDS).length} seed listings filled (the rest already had a brand, left untouched)`,
    );

    // ---- structured attributes + keywords ----
    let attributedCount = 0;
    let preservedCount = 0;
    for (const listing of [...listingsByUser.values()].flat()) {
      const written = await ensureListingAttributes(db, listing.id, LISTING_ATTRIBUTES[listing.key], termIdBySlug);
      if (written) attributedCount += 1;
      else preservedCount += 1;
    }
    console.log(
      `Attributes: ${attributedCount} listings filled, ${preservedCount} already had attributes (left untouched)`,
    );

    const after = await snapshotCounts(db);

    console.log('\n--- Summary ---');
    console.log(`Users:      ${USERS.length} fictional accounts ensured`);
    console.log(`Listings:   ${listingIndex} fictional listings ensured`);
    console.log(`Images:     ${imageCount} fictional listing images ensured`);
    console.log(`Favorites:  ${favoriteCount} fictional favorites ensured`);
    console.log('\n--- Table counts (before -> after) ---');
    for (const key of Object.keys(before)) {
      console.log(`  ${key}: ${before[key]} -> ${after[key]}`);
    }
    console.log('\nSeed complete.');
  } finally {
    await db.end();
  }
}

async function snapshotCounts(db) {
  const tables = [
    'auth.users',
    'public.profiles',
    'public.listings',
    'public.listing_images',
    'public.favorites',
    'public.listing_attribute_values',
    'public.brands',
    'public.brand_aliases',
  ];
  const counts = {};
  for (const table of tables) {
    const { rows } = await db.query(`select count(*)::int as n from ${table}`);
    counts[table] = rows[0].n;
  }
  return counts;
}

/**
 * Creates the fictional auth user if it doesn't exist yet, or looks up its
 * existing id by email if it does — idempotent either way. `handle_new_user`
 * (an existing DB trigger) auto-creates a bare profile row the moment the
 * auth user is created; `upsertProfile` below fills in the rest.
 */
async function ensureAuthUser(admin, db, user) {
  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: { seed_fixture: true },
  });

  if (!error) {
    return data.user.id;
  }

  // Already exists from a previous run — look it up directly rather than
  // paginating the admin API.
  const { rows } = await db.query('select id from auth.users where email = $1', [user.email]);
  if (rows.length === 0) {
    throw new Error(`Failed to create or find auth user for ${user.email}: ${error.message}`);
  }
  return rows[0].id;
}

async function upsertProfile(db, userId, user) {
  await db.query(
    `insert into public.profiles (id, username, display_name, bio)
     values ($1, $2, $3, $4)
     on conflict (id) do update set
       username = excluded.username,
       display_name = excluded.display_name,
       bio = excluded.bio`,
    [userId, user.username, user.displayName, user.bio],
  );
}

async function upsertListing(db, listing) {
  await db.query(
    `insert into public.listings
       (id, seller_id, title, description, price_amount, condition, size, status, category_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)
     on conflict (id) do update set
       title = excluded.title,
       description = excluded.description,
       price_amount = excluded.price_amount,
       condition = excluded.condition,
       size = excluded.size,
       category_id = excluded.category_id`,
    [
      listing.id,
      listing.sellerId,
      listing.title,
      listing.description,
      listing.priceAmount,
      listing.condition,
      listing.size,
      listing.categoryId,
      listing.createdAt,
    ],
  );
}

/**
 * Uploads the fixture image to Storage (idempotent via `upsert: true` — a
 * re-run overwrites the same deterministic path with the same bytes, never
 * creating a duplicate object) and ensures the matching `listing_images`
 * row exists. The row is only ever inserted once the upload has actually
 * succeeded, so a `listing_images` row can never point at a Storage object
 * that doesn't exist.
 */
async function ensureListingImage(admin, db, { sellerId, listingId, position, color, imageKey }) {
  const bytes = readFileSync(path.join(FIXTURES_DIR, `${color}.jpg`));
  const storagePath = `${sellerId}/${listingId}/${seedId(imageKey)}.jpg`;

  const { error: uploadError } = await admin.storage.from('listing-images').upload(storagePath, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (uploadError) {
    throw new Error(`Failed to upload fixture image ${storagePath}: ${uploadError.message}`);
  }

  await db.query(
    `insert into public.listing_images (id, listing_id, storage_path, "position")
     values ($1, $2, $3, $4)
     on conflict (id) do nothing`,
    [seedId(imageKey), listingId, storagePath, position],
  );
}

/**
 * Strictly additive: fills a seed listing's attributes and keywords only if it
 * has NONE yet. A listing that already has any value or keyword (from an
 * earlier run, or edited by hand in the app) is left exactly as it is — this
 * never deletes, replaces or merges into existing attribute data. One
 * transaction per listing, so a failure can't leave half a set behind.
 * Returns whether it wrote anything.
 */
async function ensureListingAttributes(db, listingId, spec, termIdBySlug) {
  await db.query('begin');
  try {
    const { rows } = await db.query(
      `select
         exists (select 1 from public.listing_attribute_values where listing_id = $1) as has_values,
         cardinality(keywords) > 0 as has_keywords
       from public.listings where id = $1
       for update`,
      [listingId],
    );
    if (rows.length === 0) throw new Error(`Seed listing ${listingId} not found`);
    if (rows[0].has_values || rows[0].has_keywords) {
      await db.query('commit');
      return false;
    }

    const positionByKind = new Map();
    for (const { kind, slug } of attributeSlugs(spec)) {
      const position = positionByKind.get(kind) ?? 0;
      positionByKind.set(kind, position + 1);
      await db.query(
        `insert into public.listing_attribute_values (listing_id, term_id, kind, "position")
         values ($1, $2, $3, $4)
         on conflict (listing_id, term_id) do nothing`,
        [listingId, termIdBySlug.get(`${kind}:${slug}`), kind, position],
      );
    }
    await db.query(`update public.listings set keywords = $2 where id = $1 and keywords = '{}'`, [
      listingId,
      spec.kw,
    ]);
    await db.query('commit');
    return true;
  } catch (error) {
    await db.query('rollback');
    throw new Error(`Failed to seed attributes for listing ${listingId}: ${error.message}`);
  }
}

/**
 * Strictly additive: sets a seed listing's brand only if it has NEITHER a
 * brand_id nor a brand_text yet. A brand set by an earlier run, or by hand in
 * the app, is never changed or cleared. Returns whether it wrote anything.
 */
async function ensureListingBrand(db, listingId, brandId, brandText) {
  const { rowCount } = await db.query(
    `update public.listings
        set brand_id = $2, brand_text = $3
      where id = $1 and brand_id is null and brand_text is null`,
    [listingId, brandId, brandText],
  );
  return rowCount === 1;
}

main().catch((error) => {
  console.error('\nSeed failed:', error.message ?? error);
  process.exitCode = 1;
});
