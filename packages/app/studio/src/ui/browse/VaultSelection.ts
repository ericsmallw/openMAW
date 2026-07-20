import {asDefined, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {AudioFileBox} from "@opendaw/studio-boxes"
import {InstrumentFactories} from "@opendaw/studio-adapters"
import {AudioContentFactory, ProjectStorage} from "@opendaw/studio-core"
import {HTMLSelection} from "@/ui/HTMLSelection"
import {StudioService} from "@/service/StudioService"
import {Dialogs} from "../components/dialogs"
import {ResourceSelection, truncateList} from "@/ui/browse/ResourceSelection"
import {VaultTrack} from "@/ui/browse/VaultBrowser"

export class VaultSelection implements ResourceSelection {
    readonly #service: StudioService
    readonly #selection: HTMLSelection

    constructor(service: StudioService, selection: HTMLSelection) {
        this.#service = service
        this.#selection = selection
    }

    requestDevice(): void {
        if (!this.#service.hasProfile) {return}
        const project = this.#service.project
        const {editing, boxGraph} = project

        editing.modify(() => {
            const tracks = this.#selected()
            tracks.forEach(track => {
                const {id: trackId, title, durationSeconds} = track
                const {trackBox, instrumentBox} = project.api.createInstrument(InstrumentFactories.Tape)
                instrumentBox.label.setValue(title)
                const audioFileBox = boxGraph.findBox<AudioFileBox>(UUID.parse(trackId))
                    .unwrapOrElse(() => AudioFileBox.create(boxGraph, UUID.parse(trackId), box => {
                        box.fileName.setValue(title)
                        box.startInSeconds.setValue(0)
                        if (durationSeconds && durationSeconds > 0) {
                            box.endInSeconds.setValue(durationSeconds)
                        }
                    }))
                AudioContentFactory.createNotStretchedRegion({
                    boxGraph,
                    sample: {
                        uuid: trackId,
                        name: title,
                        duration: durationSeconds ?? 0,
                        bpm: 0,
                    } as any,
                    audioFileBox,
                    position: 0,
                    targetTrack: trackBox
                })
            })
        })
    }

    async deleteSelected() {
        const tracks = this.#selected()
        if (tracks.length === 0) return
        const approved = await Dialogs.approve({
            headline: "Remove Track(s)?",
            message: "This cannot be undone!",
            approveText: "Remove"
        })
        if (!approved) return
        // Vault tracks are owned remotely — local deletion is a no-op.
        // If we want remote deletion, wire it here via the API.
    }

    #selected(): ReadonlyArray<VaultTrack> {
        const selected = this.#selection.getSelected()
        return selected.map(element => JSON.parse(asDefined(element.getAttribute("data-selection"))) as VaultTrack)
    }
}
