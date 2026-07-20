import css from "./VaultBrowser.sass?inline"
import {DefaultObservableValue, Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {StudioService} from "@/service/StudioService.ts"
import {VaultView} from "@/ui/browse/VaultView"
import {HTMLSelection} from "@/ui/HTMLSelection"
import {VaultSelection} from "@/ui/browse/VaultSelection"
import {ResourceBrowser} from "@/ui/browse/ResourceBrowser"
import {ResourceBrowserConfig} from "@/ui/browse/ResourceBrowserConfig"

import {AssetLocation} from "@/ui/browse/AssetLocation"

export interface VaultTrack {
    id: string
    title: string
    audioUrl: string | null
    coverImageUrl: string | null
    durationSeconds: number | null
    prompt: string | null
    lyrics: string | null
    stylesDescription: string | null
    trackDescription: string | null
    isPublic: boolean
    isPinned: boolean
    isArchived: boolean
    status: string
    playCount: number
    likeCount: number
    commentCount: number
    createdAt: string
    model: string | null
    director: {
        id: string
        username: string | null
        avatarUrl: string | null
    }
    userHasLiked: boolean
}

const className = Html.adoptStyleSheet(css, "VaultBrowser")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
    background?: boolean
    fontSize?: string // em
}

const MUS_API_URL = (import.meta as any).env?.VITE_MUS_API_URL ?? "http://localhost:3000"

function getSessionToken(): string | null {
    try {
        const raw = sessionStorage.getItem("openmaw_mus_session")
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed?.token ?? null
    } catch {
        return null
    }
}

async function fetchVaultTracks(): Promise<ReadonlyArray<VaultTrack>> {
    const token = getSessionToken()
    if (!token) {
        console.warn("[VaultBrowser] No MŪS session token found")
        return []
    }

    // Decode payload to extract userId (sub claim) without external libs
    const parts = token.split(".")
    if (parts.length !== 3) return []
    let payload: any = {}
    try {
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
        const pad = b64.length % 4
        const padded = pad ? b64 + "=".repeat(4 - pad) : b64
        payload = JSON.parse(atob(padded))
    } catch {
        return []
    }

    const userId = payload.sub
    if (!userId) return []

    try {
        const res = await fetch(`${MUS_API_URL}/api/openmaw?userId=${encodeURIComponent(userId)}&filter=all&limit=100`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
            },
        })
        if (!res.ok) {
            console.warn("[VaultBrowser] fetch failed:", res.status)
            return []
        }
        const data = await res.json()
        return data.library?.tracks ?? []
    } catch (err) {
        console.error("[VaultBrowser] network error:", err)
        return []
    }
}

export const VaultBrowser = ({lifecycle, service, background, fontSize}: Construct) => {
    const location = new DefaultObservableValue(AssetLocation.OpenMAW)
    const config: ResourceBrowserConfig<VaultTrack> = {
        name: "vault",
        headers: [
            {label: "Title"},
            {label: "Duration", align: "right"},
            {label: "Plays", align: "right"},
            {label: "Likes", align: "right"},
        ],
        fetchOnline: fetchVaultTracks,
        fetchLocal: async () => [],
        renderEntry: ({lifecycle: entryLifecycle, service: entryService, selection, item, location: loc, refresh}) => (
            <VaultView
                lifecycle={entryLifecycle}
                service={entryService}
                vaultSelection={selection as VaultSelection}
                track={item}
                location={loc}
                refresh={refresh}
            />
        ),
        resolveEntryName: (track: VaultTrack) => track.title,
        createSelection: (svc: StudioService, htmlSelection: HTMLSelection) => new VaultSelection(svc, htmlSelection),
        importSignal: "import-sample",
    }
    return (
        <ResourceBrowser
            lifecycle={lifecycle}
            service={service}
            config={config}
            className={className}
            background={background}
            fontSize={fontSize}
            location={location}
        />
    )
}
