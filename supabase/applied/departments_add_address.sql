-- Adds "Adresse" to departments — plain free-text, nullable, no default.
-- Editable from EditDepartmentsPage.tsx alongside the department's name.
alter table public.departments add column address text;
