-- ============================================================
-- ENUMS
-- ============================================================

create type public.listing_condition as enum (
  'new',
  'like_new',
  'very_good',
  'good',
  'fair'
);

create type public.listing_status as enum (
  'draft',
  'active',
  'reserved',
  'sold',
  'removed'
);

-- ============================================================
-- UPDATED_AT HELPER
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- PROFILES
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint username_length
    check (username is null or char_length(username) between 3 and 30)
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

-- Automatically create profile when auth user is created.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- ============================================================
-- LISTINGS
-- ============================================================

create table public.listings (
  id uuid primary key default gen_random_uuid(),

  seller_id uuid not null
    references public.profiles(id)
    on delete cascade,

  title text not null,
  description text not null default '',

  price_amount bigint not null,
  currency text not null default 'EUR',

  condition public.listing_condition not null,
  status public.listing_status not null default 'draft',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint listings_title_length
    check (char_length(title) between 3 and 120),

  constraint listings_description_length
    check (char_length(description) <= 5000),

  constraint listings_positive_price
    check (price_amount > 0),

  constraint listings_currency_format
    check (currency ~ '^[A-Z]{3}$')
);

create trigger listings_set_updated_at
before update on public.listings
for each row
execute function public.set_updated_at();

create index listings_seller_id_idx
on public.listings (seller_id);

create index listings_status_created_at_idx
on public.listings (status, created_at desc);

-- ============================================================
-- LISTING IMAGES
-- ============================================================

create table public.listing_images (
  id uuid primary key default gen_random_uuid(),

  listing_id uuid not null
    references public.listings(id)
    on delete cascade,

  storage_path text not null,
  position integer not null,

  created_at timestamptz not null default now(),

  constraint listing_images_position_nonnegative
    check (position >= 0),

  constraint listing_images_unique_position
    unique (listing_id, position)
);

create index listing_images_listing_id_idx
on public.listing_images (listing_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;

-- ============================================================
-- PROFILE POLICIES
-- ============================================================

-- Marketplace profiles are publicly readable.

create policy "Profiles are publicly readable"
on public.profiles
for select
using (true);

-- Users can update only their own profile.

create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- ============================================================
-- LISTING POLICIES
-- ============================================================

-- Anyone can see active listings.
-- Sellers can also see their own non-public listings.

create policy "Active listings are public and sellers see own listings"
on public.listings
for select
using (
  status = 'active'
  or auth.uid() = seller_id
);

create policy "Users can create own listings"
on public.listings
for insert
to authenticated
with check (
  auth.uid() = seller_id
);

create policy "Users can update own listings"
on public.listings
for update
to authenticated
using (
  auth.uid() = seller_id
)
with check (
  auth.uid() = seller_id
);

create policy "Users can delete own listings"
on public.listings
for delete
to authenticated
using (
  auth.uid() = seller_id
);

-- ============================================================
-- LISTING IMAGE POLICIES
-- ============================================================

-- Images are readable when their listing is active,
-- or when the current user owns the listing.

create policy "Listing images follow listing visibility"
on public.listing_images
for select
using (
  exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and (
        listings.status = 'active'
        or listings.seller_id = auth.uid()
      )
  )
);

create policy "Users can add images to own listings"
on public.listing_images
for insert
to authenticated
with check (
  exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = auth.uid()
  )
);

create policy "Users can update images on own listings"
on public.listing_images
for update
to authenticated
using (
  exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = auth.uid()
  )
);

create policy "Users can delete images from own listings"
on public.listing_images
for delete
to authenticated
using (
  exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = auth.uid()
  )
);
