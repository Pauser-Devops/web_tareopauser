import React, { useEffect, useState } from "react";
import { supabase, MESES } from "../../lib/supabase";
import { fetchTareoMaestroLive } from "../../lib/tareoMaestro";
import {
    calcDiasTrab,
    calcTotalHoras,
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
    const [loaded, setLoaded] = useState(false);
    const [recentSumm, setRecentSumm] = useState<RecentTareoSummary[]>([]);
    const [role, setRole] = useState("analista");

    useEffect(() => {
        const raw = window.sessionStorage.getItem("pt_auth");
        if (raw) {
            try {
                const u = JSON.parse(raw);
                setRole(u.rol || "analista");
            } catch { }
        }

        async function loadData() {
            setLoaded(false);
            const currentMonth = new Date().getMonth() + 1;

            // Evaluamos el mes actual y el mes anterior para mostrar en recientes (por ejemplo)
            const mesesAEvualuar = [currentMonth, currentMonth === 1 ? 12 : currentMonth - 1];

            const list: RecentTareoSummary[] = [];

            for (const m of mesesAEvualuar) {
                const a = (m === 12 && currentMonth === 1) ? anioActual - 1 : anioActual;

                // Para un cálculo rápido exacto como el DashboardStats
                const dataLive = await fetchTareoMaestroLive(a, m);

                let totalN = 0;
                let estadoGeneral = "Pendiente";

                if (dataLive.length > 0 && supabase) {
                    const ids = dataLive.map((d) => d.empleado_id);
                    const { data: configs } = await supabase
                        .from("tareo_employee_config")
                        .select("*")
                        .in("employee_id", ids);

                    const configMap = new Map(
                        ((configs ?? []) as unknown as TareoEmployeeConfig[]).map((c) => [c.employee_id, c])
                    );

                    let countBorrador = 0;
                    let countCerrado = 0;
                    let countSinIniciar = 0;

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

                        if (d.estado_sede === "borrador") countBorrador++;
                        else if (d.estado_sede === "cerrado") countCerrado++;
                        else countSinIniciar++;
                    });

                    // Determinar estado consolidado
                    if (countCerrado === dataLive.length) {
                        estadoGeneral = "Cerrado";
                    } else if (countBorrador > 0 || countCerrado > 0) {
                        estadoGeneral = "Borrador";
                    } else {
                        estadoGeneral = "Sin iniciar";
                    }
                }

                list.push({
                    mes: m,
                    anio: a,
                    trabajadores: dataLive.length,
                    estado: estadoGeneral,
                    netoTotal: totalN
                });
            }

            // Ordenamos: Mes actual primero (o depende como convenga, ej: descendente)
            list.sort((a, b) => {
                if (a.anio !== b.anio) return b.anio - a.anio;
                return b.mes - a.mes;
            });

            setRecentSumm(list);
            setLoaded(true);
        }

        loadData();
    }, [anioActual]);

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
                        recentSumm.map((s, idx) => {
                            const dest = role === "jefe" ? "maestro" : "analista";
                            const link = `/tareo/${dest}?anio=${s.anio}&mes=${s.mes}`;
                            let badgeClass = "badge--gray";
                            if (s.estado === "Borrador") badgeClass = "badge--yellow";
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
