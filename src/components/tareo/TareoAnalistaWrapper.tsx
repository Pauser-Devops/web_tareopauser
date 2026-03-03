/**
 * Wrapper que lee la sesión del usuario desde sessionStorage y
 * monta TareoAnalistaGrid con los props correctos.
 * Se usa con client:only="react" para evitar SSR.
 */
import React, { useEffect, useState } from "react";
import TareoAnalistaGrid from "./TareoAnalistaGrid";

type SessionUser = {
    id: string;
    nombre: string;
    position: string;
    sede: string;
    business_unit: string | null;
    rol: "jefe" | "analista";
};

type Props = {
    anio?: number;
    mes?: number;
    mesLabel?: string;
    /** Si se pasa, es vista del Jefe viendo el tareo de un analista */
    tareoAnalistaId?: string;
    readonly?: boolean;
};

export default function TareoAnalistaWrapper({ anio, mes, mesLabel, tareoAnalistaId, readonly }: Props) {
    // Si no vienen props (ej: llamado desde página estática), leer de la URL
    const isClient = typeof window !== "undefined";
    const searchParams = isClient ? new URLSearchParams(window.location.search) : null;

    const finalId = tareoAnalistaId || (searchParams?.get("id") ?? undefined);

    // Si es vista del Jefe (finalId existe), tomar anio/mes de URL o default
    const currentAnio = new Date().getFullYear();
    const currentMes = new Date().getMonth() + 1;
    const finalAnio = anio ?? (searchParams?.get("anio") ? parseInt(searchParams.get("anio")!) : currentAnio);
    const finalMes = mes ?? (searchParams?.get("mes") ? parseInt(searchParams.get("mes")!) : currentMes);
    const finalMesLabel = mesLabel ?? (isClient ? "Tareo seleccionado" : "");
    const [user, setUser] = useState<SessionUser | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const raw = window.sessionStorage.getItem("pt_auth");
        if (!raw) {
            window.location.href = "/login";
            return;
        }
        try {
            const u = JSON.parse(raw) as SessionUser;
            // Guard: si es jefe y no trae el ID desde la URL o props → redirigir
            if (u.rol !== "analista" && !finalId) {
                window.location.href = "/";
                return;
            }
            setUser(u);
        } catch {
            setError("Error al leer la sesión. Por favor, vuelve a iniciar sesión.");
        }
    }, [finalId]);

    if (error) {
        return (
            <div style={{ padding: "20px", color: "var(--color-danger)" }}>
                ⚠️ {error}
            </div>
        );
    }

    if (!user) {
        return (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--color-text-muted)" }}>
                Verificando sesión...
            </div>
        );
    }

    return (
        <TareoAnalistaGrid
            analistaId={user.id}
            analistaNombre={user.nombre}
            sede={finalId ? "" : user.sede}
            businessUnit={finalId ? null : user.business_unit}
            anio={finalAnio}
            mes={finalMes}
            mesLabel={finalMesLabel}
            tareoAnalistaId={finalId}
            readonly={readonly ?? false}
        />
    );
}
