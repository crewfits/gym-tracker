-- Trainer assignment is not part of the first-client workflow. Keep the
-- historical member column for compatibility, but remove the obsolete flag.
delete from public.gym_feature_flags
where key = 'trainer_assignment';
