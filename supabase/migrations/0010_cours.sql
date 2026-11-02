-- 0010 : section Cours (modules → sections → leçons) + progression
create table if not exists public.modules (
  id serial primary key,
  position int not null default 0,
  title text not null,
  description text default '',
  tier_required int not null default 1,
  published boolean not null default false,
  cover_url text default ''
);
create table if not exists public.course_sections (
  id serial primary key,
  module_id int references public.modules(id) on delete cascade,
  position int not null default 0,
  title text not null
);
create table if not exists public.lessons (
  id serial primary key,
  section_id int references public.course_sections(id) on delete cascade,
  position int not null default 0,
  title text not null,
  duration text default '',          -- « 13:13 »
  video_url text default '',         -- Bunny (iframe.mediadelivery.net/embed/...), YouTube, Vimeo ou .mp4
  body text default '',              -- texte sous la vidéo (liens, consignes)
  resources jsonb default '[]',      -- [{"label":"PDF UTM","url":"..."}]
  published boolean not null default true
);
create table if not exists public.lesson_progress (
  user_id uuid references public.profiles(id) on delete cascade,
  lesson_id int references public.lessons(id) on delete cascade,
  done boolean not null default true,
  done_at timestamptz default now(),
  primary key (user_id, lesson_id)
);

alter table public.modules enable row level security;
alter table public.course_sections enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_progress enable row level security;
drop policy if exists "modules: lecture" on public.modules;
create policy "modules: lecture" on public.modules for select to authenticated using (published or public.is_staff());
drop policy if exists "modules: staff" on public.modules;
create policy "modules: staff" on public.modules for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "sections: lecture" on public.course_sections;
create policy "sections: lecture" on public.course_sections for select to authenticated using (true);
drop policy if exists "sections: staff" on public.course_sections;
create policy "sections: staff" on public.course_sections for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "lessons: lecture" on public.lessons;
create policy "lessons: lecture" on public.lessons for select to authenticated using (published or public.is_staff());
drop policy if exists "lessons: staff" on public.lessons;
create policy "lessons: staff" on public.lessons for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "progress: lecture" on public.lesson_progress;
create policy "progress: lecture" on public.lesson_progress for select to authenticated using (user_id = auth.uid() or public.is_staff());
drop policy if exists "progress: moi" on public.lesson_progress;
create policy "progress: moi" on public.lesson_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Module 1 (structure reprise de Circle)
do $$
declare m int; s1 int; s2 int; s3 int;
begin
  if exists (select 1 from public.modules) then return; end if;
  insert into public.modules (position, title, description, tier_required, published) values
    (1, 'Module 1 · Ta boutique en ligne', 'Installe les bons outils, crée ta boutique Shopify et branche l''application COD. À la fin de ce module, ta boutique est prête à vendre.', 1, true) returning id into m;
  insert into public.course_sections (module_id, position, title) values (m, 1, 'Extensions Chrome à installer') returning id into s1;
  insert into public.course_sections (module_id, position, title) values (m, 2, 'Part 1 · Installation Shopify') returning id into s2;
  insert into public.course_sections (module_id, position, title) values (m, 3, 'Part 2 · Installation application COD') returning id into s3;
  insert into public.lessons (section_id, position, title, duration) values
    (s1, 1, 'Les extensions Chrome à installer', '06:24'),
    (s2, 1, 'Comment créer sa boutique Shopify', '13:13'),
    (s2, 2, 'Comment créer un logo Canva', '18:34'),
    (s2, 3, 'Installer le thème Shopify', '12:26'),
    (s3, 1, 'Introduction App COD', '11:51'),
    (s3, 2, 'Installation de l''application', '24:14'),
    (s3, 3, 'Vérifications du funnel', '05:52');
  -- les autres modules, non publiés pour l'instant
  insert into public.modules (position, title, description, tier_required, published) values
    (2, 'Module 2 · Ton compte Facebook', 'Page, Business Manager, compte publicitaire, pixel… et quoi faire en cas de blocage.', 1, false),
    (3, 'Module 3 · La méthode produits', 'Les outils, les critères, et comment trouver des produits en illimité.', 1, false),
    (4, 'Module 4 · Testing', 'Créatives, page produit, lancement et optimisation de tes premières campagnes.', 1, false),
    (5, 'Module 5 · Structure gagnante', 'Prendre en main son thème et construire une page qui convertit.', 2, false),
    (6, 'Module 6 · Scaler', 'Métriques, offre, upsell, stratégie ads et créatives IA.', 2, false);
end $$;

do $$ begin
  alter publication supabase_realtime add table public.lessons;
  alter publication supabase_realtime add table public.modules;
exception when others then null; end $$;
