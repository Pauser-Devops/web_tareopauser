/**
 * lib/tareoMaestro.ts
 * Capa de datos para el Tareo Maestro del JEFE DE GENTE Y GESTIÓN.
 */

import { supabase } from "./supabase";
import type { EmpleadoBase } from "./empleados";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface TareoMaestro {
    id: string;
    anio: number;
    mes: number;
    estado: "abierto" | "concretado";
    created_at: string;
    updated_at: string;
}

export interface TareoMaestroDetalle {
    id: string;
    tareo_maestro_id: string;
    empleado_id: string;
    sede: string | null;
    business_unit: string | null;
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
    origen_analista_id: string | null;
    empleado?: EmpleadoBase;
}

// ─── Consolidar tareo maestro ─────────────────────────────────────────────────

/**
 * Consolida todos los tareos cerrados/obs_levantadas de analistas
 * en el Tareo Maestro del mes vía RPC PostgreSQL atómica.
 *
 * La función SQL `consolidar_tareo_maestro` ejecuta el DELETE + INSERT
 * dentro de una única transacción: si algo falla, Postgres hace rollback
 * automático y el estado anterior se preserva intacto.
 *
 * SQL a ejecutar en Supabase: ver consolidar_tareo_maestro.sql
 */
export async function consolidarTareoMaestro(
    anio: number,
    mes: number
): Promise<{ ok: boolean; maestroId?: string; error?: string }> {
    if (!supabase) return { ok: false, error: "Supabase no configurado." };

    try {
        const { data, error } = await supabase.rpc("consolidar_tareo_maestro", {
            p_anio: anio,
            p_mes: mes,
        });

        if (error) {
            console.error("[tareoMaestro] RPC error:", error.message);
            return { ok: false, error: error.message };
        }

        if (!data?.ok) {
            return { ok: false, error: data?.error ?? "La consolidación falló sin detalle." };
        }

        console.log(`[tareoMaestro] Concretado: ${data.filas} filas → maestro ${data.maestro_id}`);
        return { ok: true, maestroId: data.maestro_id };

    } catch (err: any) {
        console.error("[tareoMaestro] consolidarTareoMaestro exception:", err);
        return { ok: false, error: err?.message ?? "Error inesperado al consolidar." };
    }
}


// ─── Leer tareo maestro ───────────────────────────────────────────────────────

/**
 * Trae el tareo maestro de un mes (si existe).
 */
export async function fetchTareoMaestro(
    anio: number,
    mes: number
): Promise<TareoMaestro | null> {
    if (!supabase) return null;

    const { data } = await supabase
        .from("tareo_maestro")
        .select("*")
        .eq("anio", anio)
        .eq("mes", mes)
        .single();

    return data as TareoMaestro | null;
}

/**
 * Trae los detalles completos del tareo maestro de un mes,
 * enriquecidos con datos del empleado.
 */
export async function fetchMaestroDetalle(
    anio: number,
    mes: number
): Promise<{ maestro: TareoMaestro | null; detalles: TareoMaestroDetalle[] }> {
    if (!supabase) return { maestro: null, detalles: [] };

    // Buscar tareo maestro
    const { data: maestro } = await supabase
        .from("tareo_maestro")
        .select("*")
        .eq("anio", anio)
        .eq("mes", mes)
        .single();

    if (!maestro) return { maestro: null, detalles: [] };

    // Traer detalles
    const { data: detalles } = await supabase
        .from("tareo_maestro_detalle")
        .select("*")
        .eq("tareo_maestro_id", maestro.id)
        .order("sede")
        .order("business_unit");

    if (!detalles || detalles.length === 0) {
        return { maestro: maestro as TareoMaestro, detalles: [] };
    }

    // Enriquecer con datos de empleados
    const empleadoIds = detalles.map((d: any) => d.empleado_id);
    const { data: empleados } = await supabase
        .from("employees")
        .select("id, dni, full_name, position, sede, business_unit, entry_date, is_active, termination_date, created_at, updated_at, employee_type")
        .in("id", empleadoIds);

    const empMap = new Map(
        ((empleados ?? []) as unknown as EmpleadoBase[]).map((e) => [e.id, e])
    );

    return {
        maestro: maestro as TareoMaestro,
        detalles: (detalles as any[]).map((d) => ({
            ...d,
            empleado: empMap.get(d.empleado_id),
        })) as TareoMaestroDetalle[],
    };
}

// ─── Estado de tareos para botón "Concretar" ─────────────────────────────────

export async function todosLosTareosCerrados(
    anio: number,
    mes: number
): Promise<{ todos: boolean; totalAnalistas: number; cerrados: number; enRevision: number }> {
    if (!supabase) return { todos: false, totalAnalistas: 0, cerrados: 0, enRevision: 0 };

    const { data } = await supabase
        .from("tareos_analista")
        .select("estado")
        .eq("anio", anio)
        .eq("mes", mes);

    const lista = (data ?? []) as { estado: string }[];
    const total = lista.length;
    // cerrado u obs_levantadas = listos para concretar
    const listos = lista.filter((t) => t.estado === "cerrado" || t.estado === "obs_levantadas").length;
    const enRevision = lista.filter((t) => t.estado === "en_revision").length;

    return {
        todos: total > 0 && total === listos,
        totalAnalistas: total,
        cerrados: listos,
        enRevision,
    };
}

// ─── Reabrir tareo maestro ────────────────────────────────────────────────────

/**
 * Reabre un tareo maestro ya concretado, pasando su estado a "abierto".
 * Esto permite volver a concretar el período si hubo correcciones.
 */
export async function reabrirTareoMaestro(
    anio: number,
    mes: number
): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Supabase no configurado." };

    const { error } = await supabase
        .from("tareo_maestro")
        .update({ estado: "abierto", updated_at: new Date().toISOString() })
        .eq("anio", anio)
        .eq("mes", mes);

    if (error) {
        console.error("[tareoMaestro] reabrirTareoMaestro:", error.message);
        return { ok: false, error: error.message };
    }
    return { ok: true };
}

// ─── Live Consolidation (Vista de todos los empleados) ────────────────────────

export interface TareoFilaLive extends TareoMaestroDetalle {
    estado_sede: "sin_iniciar" | "borrador" | "cerrado";
}

export async function fetchTareoMaestroLive(
    anio: number,
    mes: number
): Promise<TareoFilaLive[]> {
    if (!supabase) return [];

    // 1. Fetch all active employees
    const { data: empleados } = await supabase
        .from("employees")
        .select("id, dni, full_name, position, sede, business_unit, entry_date, is_active, termination_date")
        .eq("is_active", true)
        .order("full_name");

    const emps = (empleados ?? []) as EmpleadoBase[];

    // 2. Fetch all tareos_analista for this month/year
    const { data: tareosSedes } = await supabase
        .from("tareos_analista")
        .select("id, estado")
        .eq("anio", anio)
        .eq("mes", mes);

    const sedesMap = new Map((tareosSedes ?? []).map((t) => [t.id, t.estado]));
    const tareoIds = Array.from(sedesMap.keys());

    // 3. Fetch all details for these tareos
    let detallesAnalista: any[] = [];
    if (tareoIds.length > 0) {
        const { data: detalles } = await supabase
            .from("tareos_analista_detalle")
            .select("*")
            .in("tareo_analista_id", tareoIds);
        if (detalles) detallesAnalista = detalles;
    }

    const detalleMap = new Map(detallesAnalista.map((d) => [d.empleado_id, d]));

    // 4. Merge
    const result: TareoFilaLive[] = emps.map((emp) => {
        const d = detalleMap.get(emp.id);
        const estadoRaw = d ? (sedesMap.get(d.tareo_analista_id) ?? null) : null;
        let estadoSede: "sin_iniciar" | "borrador" | "cerrado";
        if (!estadoRaw) {
            estadoSede = "sin_iniciar";
        } else if (estadoRaw === "cerrado" || estadoRaw === "obs_levantadas") {
            estadoSede = "cerrado";
        } else {
            // abierto | borrador | en_revision → en progreso
            estadoSede = "borrador";
        }


        return {
            id: d?.id ?? `virtual_${emp.id}`,
            tareo_maestro_id: "virtual",
            empleado_id: emp.id,
            sede: emp.sede,
            business_unit: emp.business_unit,
            dias_habiles: d?.dias_habiles ?? 30,
            descanso_lab: d?.descanso_lab ?? 0,
            desc_med: d?.desc_med ?? 0,
            vel: d?.vel ?? 0,
            vac: d?.vac ?? 0,
            lic_sin_h: d?.lic_sin_h ?? 0,
            susp: d?.susp ?? 0,
            aus_sin_just: d?.aus_sin_just ?? 0,
            movilidad: d?.movilidad ?? 0,
            comision: d?.comision ?? 0,
            bono_productiv: d?.bono_productiv ?? 0,
            bono_alimento: d?.bono_alimento ?? 0,
            ret_jud: d?.ret_jud ?? 0,
            origen_analista_id: d?.tareo_analista_id ?? null,
            empleado: emp,
            estado_sede: estadoSede as "sin_iniciar" | "borrador" | "cerrado"
        };
    });

    return result;
}
