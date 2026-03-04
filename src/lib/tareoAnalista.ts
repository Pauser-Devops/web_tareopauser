/**
 * lib/tareoAnalista.ts
 * Capa de datos para el módulo de ANALISTA DE GENTE Y GESTIÓN.
 * Gestiona tareos personales filtrados por sede + unidad de negocio.
 */

import { supabase } from "./supabase";
import type { EmpleadoBase } from "./empleados";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type EstadoTareoAnalista = "borrador" | "cerrado" | "en_revision" | "obs_levantadas";

export interface TareoAnalista {
    id: string;
    analista_id: string;
    sede: string;
    business_unit: string;
    anio: number;
    mes: number;
    estado: EstadoTareoAnalista;
    observaciones: string | null;
    created_at: string;
    updated_at: string;
}

export interface TareoAnalistaDetalle {
    id?: string;
    tareo_analista_id: string;
    empleado_id: string;
    dias_habiles: number;
    descanso_lab: number;
    desc_med: number;
    vel: number;
    vac: number;
    lic_sin_h: number;
    susp: number;
    aus_sin_just: number;
    movilidad: number;
    comision: number;
    bono_productiv: number;
    bono_alimento: number;
    ret_jud: number;
    updated_at?: string;
}

export interface EmpleadoConDetalle extends EmpleadoBase {
    detalle: TareoAnalistaDetalle | null;
}

export interface TareoAnalistaResumen {
    id: string;
    analista_id: string;
    sede: string;
    business_unit: string;
    anio: number;
    mes: number;
    estado: EstadoTareoAnalista;
    observaciones: string | null;
    cantidad_empleados: number;
    analista_nombre?: string;
}

// ─── Obtener o crear tareo del analista ──────────────────────────────────────

/**
 * Recupera el tareo del analista para el mes dado.
 * Si no existe, lo crea en estado 'borrador'.
 */
export async function fetchOrCreateTareoAnalista(
    analistaId: string,
    sede: string,
    businessUnit: string,
    anio: number,
    mes: number
): Promise<TareoAnalista | null> {
    if (!supabase) return null;

    // Intentar obtener existente
    const { data: existing } = await supabase
        .from("tareos_analista")
        .select("*")
        .eq("analista_id", analistaId)
        .eq("anio", anio)
        .eq("mes", mes)
        .single();

    if (existing) return existing as TareoAnalista;

    // Crear nuevo
    const { data: created, error } = await supabase
        .from("tareos_analista")
        .insert({
            analista_id: analistaId,
            sede,
            business_unit: businessUnit,
            anio,
            mes,
            estado: "borrador",
        })
        .select()
        .single();

    if (error) {
        console.error("[tareoAnalista] fetchOrCreateTareoAnalista:", error.message);
        return null;
    }

    return created as TareoAnalista;
}

// ─── Empleados de la sede/unidad ─────────────────────────────────────────────

/**
 * Trae empleados activos de la sede y business_unit del analista.
 * Si businessUnit es null o vacío, filtra solo por sede.
 */
export async function fetchEmpleadosDeSede(
    sede: string,
    businessUnit: string | null
): Promise<EmpleadoBase[]> {
    if (!supabase) return [];

    let query = supabase
        .from("employees")
        .select(
            "id, dni, full_name, position, sede, business_unit, entry_date, " +
            "is_active, termination_date, created_at, updated_at, employee_type"
        )
        .eq("is_active", true)
        .is("termination_date", null)
        .eq("sede", sede)
        .order("full_name");

    if (businessUnit) {
        query = query.eq("business_unit", businessUnit);
    }

    const { data, error } = await query;

    if (error) {
        console.error("[tareoAnalista] fetchEmpleadosDeSede:", error.message);
        return [];
    }

    return (data ?? []) as unknown as EmpleadoBase[];
}

// ─── Detalles del tareo ───────────────────────────────────────────────────────

/**
 * Trae los detalles de empleados para un tareo de analista.
 */
export async function fetchDetallesAnalista(
    tareoAnalistaId: string
): Promise<TareoAnalistaDetalle[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from("tareos_analista_detalle")
        .select("*")
        .eq("tareo_analista_id", tareoAnalistaId);

    if (error) {
        console.error("[tareoAnalista] fetchDetallesAnalista:", error.message);
        return [];
    }

    return (data ?? []) as unknown as TareoAnalistaDetalle[];
}

/**
 * Guarda (upsert) un detalle de empleado en el tareo del analista.
 */
export async function upsertDetalleAnalista(
    detalle: TareoAnalistaDetalle
): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Supabase no configurado." };

    const { error } = await supabase
        .from("tareos_analista_detalle")
        .upsert(
            { ...detalle, updated_at: new Date().toISOString() },
            { onConflict: "tareo_analista_id,empleado_id" }
        );

    if (error) {
        console.error("[tareoAnalista] upsertDetalleAnalista:", error.message);
        return { ok: false, error: error.message };
    }
    return { ok: true };
}

/**
 * Guarda múltiples detalles en lote (más eficiente).
 */
export async function upsertDetallesLote(
    detalles: TareoAnalistaDetalle[]
): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Supabase no configurado." };
    if (detalles.length === 0) return { ok: true };

    const rows = detalles.map((d) => ({
        ...d,
        updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
        .from("tareos_analista_detalle")
        .upsert(rows, { onConflict: "tareo_analista_id,empleado_id" });

    if (error) {
        console.error("[tareoAnalista] upsertDetallesLote:", error.message);
        return { ok: false, error: error.message };
    }
    return { ok: true };
}

// ─── Cierre del tareo ─────────────────────────────────────────────────────────

/**
 * Cierra el tareo del analista. No se puede deshacer desde el frontend.
 */
export async function cerrarTareoAnalista(
    tareoAnalistaId: string
): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Supabase no configurado." };

    const { error } = await supabase
        .from("tareos_analista")
        .update({ estado: "cerrado", updated_at: new Date().toISOString() })
        .eq("id", tareoAnalistaId);

    if (error) {
        console.error("[tareoAnalista] cerrarTareoAnalista:", error.message);
        return { ok: false, error: error.message };
    }
    return { ok: true };
}

// ─── Flujo de revisión Jefe ↔ Analista ───────────────────────────────────────

/**
 * El Jefe manda el tareo del analista a revisión, con observaciones.
 * Estado: cerrado | obs_levantadas → en_revision
 */
export async function mandarARevision(
    tareoAnalistaId: string,
    observaciones: string
): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Supabase no configurado." };

    const { error } = await supabase
        .from("tareos_analista")
        .update({
            estado: "en_revision",
            observaciones: observaciones.trim(),
            updated_at: new Date().toISOString(),
        })
        .eq("id", tareoAnalistaId);

    if (error) {
        console.error("[tareoAnalista] mandarARevision:", error.message);
        return { ok: false, error: error.message };
    }
    return { ok: true };
}

/**
 * El Analista marca que ha levantado las observaciones.
 * Estado: en_revision → obs_levantadas
 */
export async function marcarObsLevantadas(
    tareoAnalistaId: string
): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Supabase no configurado." };

    const { error } = await supabase
        .from("tareos_analista")
        .update({
            estado: "obs_levantadas",
            updated_at: new Date().toISOString(),
        })
        .eq("id", tareoAnalistaId);

    if (error) {
        console.error("[tareoAnalista] marcarObsLevantadas:", error.message);
        return { ok: false, error: error.message };
    }
    return { ok: true };
}

// ─── Vista del Jefe: todos los tareos de analistas ───────────────────────────

/**
 * Trae todos los tareos de analistas para un mes dado (para el Jefe).
 * Incluye conteo de empleados en cada tareo.
 */
export async function fetchTareosPorMes(
    anio: number,
    mes: number
): Promise<TareoAnalistaResumen[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from("tareos_analista")
        .select(
            "id, analista_id, sede, business_unit, anio, mes, estado, observaciones, " +
            "tareos_analista_detalle(count)"
        )
        .eq("anio", anio)
        .eq("mes", mes)
        .order("sede")
        .order("business_unit");

    if (error) {
        console.error("[tareoAnalista] fetchTareosPorMes:", error.message);
        return [];
    }

    return ((data ?? []) as any[]).map((t) => ({
        id: t.id,
        analista_id: t.analista_id,
        sede: t.sede,
        business_unit: t.business_unit,
        anio: t.anio,
        mes: t.mes,
        estado: t.estado,
        observaciones: t.observaciones ?? null,
        cantidad_empleados: t.tareos_analista_detalle?.[0]?.count ?? 0,
    }));
}

/**
 * Trae los empleados y detalles de UN tareo de analista específico (para vista Jefe).
 */
export async function fetchTareoAnalistaConDetalle(
    tareoAnalistaId: string
): Promise<{ tareo: TareoAnalista | null; detalles: TareoAnalistaDetalle[] }> {
    if (!supabase) return { tareo: null, detalles: [] };

    const [{ data: tareo }, { data: detalles }] = await Promise.all([
        supabase
            .from("tareos_analista")
            .select("*")
            .eq("id", tareoAnalistaId)
            .single(),
        supabase
            .from("tareos_analista_detalle")
            .select("*")
            .eq("tareo_analista_id", tareoAnalistaId),
    ]);

    return {
        tareo: tareo as TareoAnalista | null,
        detalles: (detalles ?? []) as unknown as TareoAnalistaDetalle[],
    };
}

// ─── Historial de tareos del analista ─────────────────────────────────────────

/**
 * Trae todos los tareos de un analista específico (para su lista de meses).
 */
export async function fetchTareosDelAnalista(
    analistaId: string,
    anio: number
): Promise<TareoAnalista[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from("tareos_analista")
        .select("*")
        .eq("analista_id", analistaId)
        .eq("anio", anio)
        .order("mes");

    if (error) {
        console.error("[tareoAnalista] fetchTareosDelAnalista:", error.message);
        return [];
    }

    return (data ?? []) as unknown as TareoAnalista[];
}
