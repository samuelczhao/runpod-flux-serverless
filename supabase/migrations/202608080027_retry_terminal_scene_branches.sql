drop index public.scene_versions_single_branch_idx;

create unique index scene_versions_single_branch_idx
on public.scene_versions (scene_id)
where parent_version_id is not null and status not in ('FAILED', 'CANCELLED');
