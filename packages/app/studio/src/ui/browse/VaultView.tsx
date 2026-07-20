import css from "./VaultView.sass?inline"
import {createElement} from "@opendaw/lib-jsx"
import {Exec, Lifecycle, isDefined} from "@opendaw/lib-std"
import {Icon} from "../components/Icon"
import {IconSymbol} from "@opendaw/studio-enums"
import {Html} from "@opendaw/lib-dom"
import {DragAndDrop} from "@/ui/DragAndDrop"
import {VaultSelection} from "@/ui/browse/VaultSelection"
import {VaultTrack} from "@/ui/browse/VaultBrowser"
import {StudioService} from "@/service/StudioService"

const className = Html.adoptStyleSheet(css, "VaultView")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
    vaultSelection: VaultSelection
    track: VaultTrack
    location: any
    refresh: Exec
}

const formatDuration = (seconds: number | null): string => {
    if (!seconds || seconds <= 0) return "--:--"
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, "0")}`
}

export const VaultView = ({lifecycle, service, vaultSelection, track, location, refresh}: Construct) => {
    const {title, durationSeconds, playCount, likeCount, audioUrl} = track
    const element: HTMLElement = (
        <div className={className}
             data-selection={JSON.stringify(track)}
             draggable
             onInit={element => lifecycle.ownAll(
                 DragAndDrop.installSource(element, () => ({type: "audio-url", url: audioUrl})),
             )}>
            <div className="meta"
                 ondblclick={() => vaultSelection.requestDevice()}>
                <span>{title}</span>
                <span className="right">{formatDuration(durationSeconds)}</span>
                <span className="right">{playCount}</span>
                <span className="right">{likeCount}</span>
            </div>
        </div>
    )
    return element
}
