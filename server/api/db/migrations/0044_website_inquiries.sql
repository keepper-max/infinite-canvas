-- Additive only: anonymous website inquiries never change user_feedback ownership.
create table website_inquiries (
  id uuid primary key,
  content text not null,
  contact text not null,
  status text not null default 'open' check (status in ('open','closed')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index website_inquiries_created_idx on website_inquiries(created_at desc);
