CREATE TABLE IF NOT EXISTS public.observaciones_importacion (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tareo_analista_id UUID REFERENCES public.tareos_analista(id) ON DELETE CASCADE,
    dni_erroneo VARCHAR(20) NOT NULL,
    fila_excel INT NOT NULL,
    detalles_json JSONB,
    estado VARCHAR(50) DEFAULT 'Pendiente',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
