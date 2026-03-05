import React, { useEffect, useState, useCallback } from "react";
import { useStore } from "@nanostores/react";
import { $user } from "../../lib/stores";
import { supabase, MESES } from "../../lib/supabase";
import { fetchTareoMaestroLive } from "../../lib/tareoMaestro";
import {
    calcDiasTrab,
    calcTotalIngresos,
    calcTotalDescuentos,
    calcNetoPagar,
    round2,
    calcSueldoProporcional,
    calcAfpOnpSimple,
    calcVidaLey
} from "../../lib/formulas";
import type { TareoEmployeeConfig } from "../../lib/empleados";

interface RecentTareoSummary {
    mes: number;
    anio: number;
    trabajadores: number;
    estado: string;
    netoTotal: number;
}

export default function DashboardRecentTareos({ anioActual }: { anioActual: number }) {
    const user = useStore($user);
    const role = user?.rol ?? "analista";

    const [loaded, setLoaded] = useState(false);
    const [recentSumm, setRecentSumm] = useState<RecentTareoSummary[]>([]);

    // ── Función de carga extraída al nivel del componente ──────────────────────
    const loadData = useCallback(async () => {
        setLoaded(false);
        const currentMonth = new Date().getMonth() + 1;
        const mesesAEvaluar = [currentMonth, currentMonth === 1 ? 12 : currentMonth - 1];
        const list: RecentTareoSummary[] = [];

        for (const m of mesesAEvaluar) {
            const a = (m === 12 && currentMonth === 1) ? anioActual - 1 : anioActual;
            const dataLive = await fetchTareoMaestroLive(a, m);

            let totalN = 0;
            let estadoGeneral = "Sin iniciar";

            if (dataLive.length > 0 && supabase) {
                const ids = dataLive.map((d) => d.empleado_id);

                // ── Calcular neto total ────────────────────────────────────────
                const { data: configs } = await supabase
                    .from("tareo_employee_config")
                    .select("*")
                    .in("employee_id", ids);

                const configMap = new Map(
                    ((configs ?? []) as unknown as TareoEmployeeConfig[]).map((c) => [c.employee_id, c])
                );

                dataLive.forEach(d => {
                    const config = configMap.get(d.empleado_id);
                    const sueldoBase = config?.sueldo_base ?? 0;
                    const afp = config?.afp_codigo ?? "ONP";
                    const tieneVidaLey = config?.vida_ley ?? false;

                    const diasTrab = calcDiasTrab(d.dias_habiles, d.vac, d.lic_sin_h, d.susp, d.aus_sin_just);
                    const sueldoProp = calcSueldoProporcional(sueldoBase, diasTrab, 30);
                    const totalAfecto = round2(sueldoProp);
                    const totalNoAfecto = round2(d.movilidad);
                    const totalIngresos = calcTotalIngresos(totalAfecto, totalNoAfecto);
                    const afpOnp = calcAfpOnpSimple(totalAfecto, afp);
                    const vidaLey = calcVidaLey(totalAfecto, tieneVidaLey);
                    const totalDesc = calcTotalDescuentos({ afp_onp: afpOnp, vida_ley: vidaLey, ret_jud: d.ret_jud });
                    totalN += calcNetoPagar(totalIngresos, totalDesc);
                });

                // ── Estado del mes basado en tareos de analistas (no por empleado) ──
                // cerrado u obs_levantadas = analista terminó; en_revision = en revisión
                const { data: tareosSedes } = await supabase
                    .from("tareos_analista")
                    .select("estado")
                    .eq("anio", a)
                    .eq("mes", m);

                const estadosList = (tareosSedes ?? []) as { estado: string }[];
                const totalAnalistas = estadosList.length;

                if (totalAnalistas === 0) {
                    estadoGeneral = "Sin iniciar";
                } else {
                    const cerrados = estadosList.filter(t =>
                        t.estado === "cerrado" || t.estado === "obs_levantadas"
                    ).length;
                    const enRevision = estadosList.filter(t => t.estado === "en_revision").length;

                    if (cerrados === totalAnalistas) {
                        estadoGeneral = "Cerrado";
                    } else if (enRevision > 0) {
                        estadoGeneral = "En revisión";
                    } else {
                        estadoGeneral = "Borrador";
                    }
                }
            }

            list.push({ mes: m, anio: a, trabajadores: dataLive.length, estado: estadoGeneral, netoTotal: totalN });
        }

        list.sort((a, b) => {
            if (a.anio !== b.anio) return b.anio - a.anio;
            return b.mes - a.mes;
        });

        setRecentSumm(list);
        setLoaded(true);
    }, [anioActual]);

    // Carga inicial
    useEffect(() => {
        loadData();
    }, [loadData]);

    // Re-fetch cuando el usuario vuelve a la pestaña o a la ventana
    useEffect(() => {
        const handleVisible = () => {
            if (document.visibilityState === "visible") loadData();
        };
        const handleFocus = () => loadData();

        document.addEventListener("visibilitychange", handleVisible);
        window.addEventListener("focus", handleFocus);
        return () => {
            document.removeEventListener("visibilitychange", handleVisible);
            window.removeEventListener("focus", handleFocus);
        };
    }, [loadData]);

    return (
        <div className="table-wrapper" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
                <thead>
                    <tr>
                        <th>Mes</th>
                        <th>Año</th>
                        <th>Trabajadores</th>
                        <th>Estado</th>
                        <th>Neto Total</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {!loaded ? (
                        <tr>
                            <td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "20px" }}>
                                Cargando tareos recientes...
                            </td>
                        </tr>
                    ) : (
                        recentSumm.map((s) => {
                            const dest = role === "jefe" ? "maestro" : "analista";
                            const link = `/tareo/${dest}?anio=${s.anio}&mes=${s.mes}`;
                            let badgeClass = "badge--gray";
                            if (s.estado === "Borrador") badgeClass = "badge--yellow";
                            if (s.estado === "En revisión") badgeClass = "badge--orange";
                            if (s.estado === "Cerrado") badgeClass = "badge--green";

                            return (
                                <tr key={`${s.anio}-${s.mes}`}>
                                    <td style={{ fontWeight: 600 }}>{MESES[s.mes]}</td>
                                    <td className="text-muted">{s.anio}</td>
                                    <td>{s.trabajadores > 0 ? s.trabajadores : "—"}</td>
                                    <td>
                                        <span className={`badge ${badgeClass}`}>
                                            {s.estado}
                                        </span>
                                    </td>
                                    <td className="cell-currency">
                                        {s.netoTotal > 0 ? `S/ ${s.netoTotal.toLocaleString("es-PE", { minimumFractionDigits: 2 })}` : "—"}
                                    </td>
                                    <td>
                                        <a href={link} className="btn btn--secondary" style={{ fontSize: "12px", padding: "5px 12px" }}>
                                            {(s.estado === "Borrador" || s.estado === "Cerrado") ? "Editar" : "Crear"}
                                        </a>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
}
