-- Añadir columnas para bonos y comisiones en los detalles del tareo del analista
ALTER TABLE public.tareos_analista_detalle 
ADD COLUMN IF NOT EXISTS comision NUMERIC(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS bono_productiv NUMERIC(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS bono_alimento NUMERIC(12,2) DEFAULT 0;
