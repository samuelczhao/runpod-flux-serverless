update public.dreams dream
set mood = coalesce((
  select array_agg(candidate.label order by candidate.label)
  from (
    select distinct lower(trim(motif.canonical_label)) as label
    from public.dream_motifs link
    join public.motifs motif on motif.id = link.motif_id
    where link.dream_id = dream.id and motif.kind = 'emotion'
      and lower(trim(motif.canonical_label)) = any(array[
        'awe', 'calm', 'confusion', 'curiosity', 'delight', 'fear', 'hope',
        'joy', 'loneliness', 'longing', 'melancholy', 'mystery', 'nostalgia',
        'peace', 'sadness', 'serenity', 'tension', 'unease', 'uncertainty',
        'urgency', 'wonder'
      ]::text[])
    order by label
    limit 3
  ) candidate
), array['unclassified']::text[])
where cardinality(dream.mood) > 0 and not dream.mood <@ array[
  'awe', 'calm', 'confusion', 'curiosity', 'delight', 'fear', 'hope',
  'joy', 'loneliness', 'longing', 'melancholy', 'mystery', 'nostalgia',
  'peace', 'sadness', 'serenity', 'tension', 'unease', 'uncertainty',
  'urgency', 'wonder'
]::text[];

alter table public.dreams add constraint dreams_mood_quality check (
  cardinality(mood) <= 3
  and mood <@ array[
    'awe', 'calm', 'confusion', 'curiosity', 'delight', 'fear', 'hope',
    'joy', 'loneliness', 'longing', 'melancholy', 'mystery', 'nostalgia',
    'peace', 'sadness', 'serenity', 'tension', 'unease', 'uncertainty',
    'urgency', 'wonder', 'unclassified'
  ]::text[]
  and (status <> 'READY' or cardinality(mood) between 1 and 3)
);
