/**
 * Wrapper del panel del Jefe — lee sesión y aplica guard de rol.
 */
import React, { useEffect, useState } from "react";
import TareoJefePanel from "./TareoJefePanel";

type SessionUser = {
    id: string;
    nombre: string;
    sede: string;
    business_unit: string | null;
    rol: "jefe" | "analista";
};

type Props = {
    anioInicial: number;
    mesInicial: number;
};

export default function TareoJefeWrapper({ anioInicial, mesInicial }: Props) {
    const [user, setUser] = useState<SessionUser | null>(null);

    useEffect(() => {
        const raw = window.sessionStorage.getItem("pt_auth");
        if (!raw) { window.location.href = "/login"; return; }
        try {
            const u = JSON.parse(raw) as SessionUser;
            if (u.rol !== "jefe") { window.location.href = "/"; return; }
            setUser(u);
        } catch {
            window.location.href = "/login";
        }
    }, []);

    if (!user) {
        return (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--color-text-muted)" }}>
                Verificando sesión...
            </div>
        );
    }

    return <TareoJefePanel anioInicial={anioInicial} mesInicial={mesInicial} />;
}
