-- Agregar columnas faltantes a la tabla tareo_employee_config

ALTER TABLE public.tareo_employee_config
ADD COLUMN IF NOT EXISTS banco text,
ADD COLUMN IF NOT EXISTS eps boolean DEFAULT false;

-- Confirmar que cuenta_haberes exista (por si acaso)
ALTER TABLE public.tareo_employee_config
ADD COLUMN IF NOT EXISTS cuenta_haberes text;
