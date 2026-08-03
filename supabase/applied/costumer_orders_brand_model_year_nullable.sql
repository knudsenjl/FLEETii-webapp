-- Brand/Mærke ("model")/Årgang ("model_year") are no longer required on
-- NewVehiclePage.tsx's "Ny bestilling" form -- FLEETii staff can now fill
-- them in later on VehicleCreatePage.tsx (editable inputs, with a MotorAPI
-- lookup button to auto-fill from the registration number). Relaxes the
-- NOT NULL constraints so send-vehicle-request.mts can insert null instead
-- of requiring non-empty strings.
alter table public.costumer_orders alter column brand drop not null;
alter table public.costumer_orders alter column model drop not null;
alter table public.costumer_orders alter column model_year drop not null;
