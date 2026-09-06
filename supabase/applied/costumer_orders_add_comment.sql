-- Adds a free-text "Kommentarer" field to the "Ny bestilling" form
-- (NewVehiclePage.tsx) — anything the admin wants to flag to FLEETii staff
-- re. the vehicle or installation, surfaced in the request email (see
-- send-vehicle-request.mts's buildHtmlBody). Nullable/optional, same as
-- parking/vehicle_ident (costumer_orders_add_parking.sql).
alter table public.costumer_orders add column comment text;
