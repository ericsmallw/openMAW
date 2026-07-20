if ("stackTraceLimit" in Error) {Error.stackTraceLimit = 50}

import "./main.sass"
import {App} from "@/ui/App.tsx"
import {isDefined, panic, Progress, RuntimeNotification, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {StudioService} from "@/service/StudioService"
import {SampleMetaData, SoundfontMetaData} from "@opendaw/studio-adapters"
import {Dialogs} from "@/ui/components/dialogs.tsx"
import {installCursors} from "@/ui/Cursors.ts"
import {BuildInfo} from "./BuildInfo"
import {Surface} from "@/ui/surface/Surface.tsx"
import {replaceChildren} from "@opendaw/lib-jsx"
import {
    AudioContentFactory,
    AudioWorklets,
    BufferUnderrunDetector,
    CloudAuthManager,
    ContextMenu,
    GlobalSampleLoaderManager,
    GlobalSoundfontLoaderManager,
    OfflineEngineRenderer,
    OpenSampleAPI,
    OpenSoundfontAPI,
    Project,
    Workers
} from "@opendaw/studio-core"
import {AudioFileBox} from "@opendaw/studio-boxes"
import {InstrumentFactories} from "@opendaw/studio-adapters"
import {testFeatures} from "@/features.ts"
import {MissingFeature} from "@/ui/MissingFeature.tsx"
import {UpdateMessage} from "@/ui/UpdateMessage.tsx"
import {showStoragePersistDialog} from "@/AppDialogs"
import {Promises} from "@opendaw/lib-runtime"
import {AnimationFrame, Browser, Html, ShortcutManager} from "@opendaw/lib-dom"
import {AudioOutputDevice} from "@/audio/AudioOutputDevice"
import {installLatencyReporter} from "@/LatencyReporter"
import {MusSessionService} from "@/service/MusSessionService"
import {reportVisitor} from "@/VisitorReporter"
import {FontLoader} from "@/ui/FontLoader"
import {ErrorHandler} from "@/errors/ErrorHandler.ts"
import {AudioData} from "@opendaw/lib-dsp"
import {ChainedSampleProvider, ChainedSoundfontProvider} from "@opendaw/studio-p2p"
import {IconSymbol} from "@opendaw/studio-enums"
import {StudioShortcutManager} from "@/service/StudioShortcutManager"
import {Menu} from "@/ui/components/Menu"

const loadBuildInfo = async () => fetch(`/build-info.json?v=${Date.now()}`)
    .then(x => x.json())
    .then(x => BuildInfo.parse(x))

export const boot = async ({workersUrl, workletsUrl, offlineEngineUrl}: {
    workersUrl: string, workletsUrl: string, offlineEngineUrl: string
}) => {
    console.debug("booting...")
    console.debug(location.origin)
    const {status, value: buildInfo} = await Promises.tryCatch(loadBuildInfo())
    if (status === "rejected") {
        alert("Error loading build info. Please reload the page.")
        return
    }
    console.debug("buildInfo", JSON.stringify(buildInfo, null, 2))
    await FontLoader.load()
    await Workers.install(workersUrl)
    AudioWorklets.install(workletsUrl)
    OfflineEngineRenderer.install(offlineEngineUrl)
    const testFeaturesResult = await Promises.tryCatch(testFeatures())
    if (testFeaturesResult.status === "rejected") {
        document.querySelector("#preloader")?.remove()
        replaceChildren(document.body, MissingFeature({error: testFeaturesResult.error}))
        return
    }
    console.debug("isLocalHost", Browser.isLocalHost())
    console.debug("agent", Browser.userAgent)
    console.debug("crossOriginIsolated", window.crossOriginIsolated)
    console.debug("location", window.location.href)
    const sampleRate = Browser.isFirefox() ? undefined : 48000
    console.debug("requesting custom sampleRate", sampleRate ?? "'No (Firefox)'")
    const context = new AudioContext({sampleRate, latencyHint: 0})
    console.debug(`AudioContext state: ${context.state}, sampleRate: ${context.sampleRate}`)
    console.debug(`Error.stackTraceLimit: ${Error.stackTraceLimit ?? "N/A"}`)
    installLatencyReporter(context)
    reportVisitor()
    const audioWorklets = await Promises.tryCatch(AudioWorklets.createFor(context))
    if (audioWorklets.status === "rejected") {
        return panic(audioWorklets.error)
    }
    if (context.state === "suspended") {
        window.addEventListener("click",
            async () => await context.resume().then(() =>
                console.debug(`AudioContext resumed (${context.state})`)), {capture: true, once: true})
    }
    const audioDevices = await AudioOutputDevice.create(context)
    const chainedSampleProvider = new ChainedSampleProvider({
        fetch: async (uuid: UUID.Bytes, progress: Progress.Handler): Promise<[AudioData, SampleMetaData]> =>
            OpenSampleAPI.get().load(uuid, progress)
    })
    const chainedSoundfontProvider = new ChainedSoundfontProvider({
        fetch: async (uuid: UUID.Bytes, progress: Progress.Handler): Promise<[ArrayBuffer, SoundfontMetaData]> =>
            OpenSoundfontAPI.get().load(uuid, progress)
    })
    const sampleManager = new GlobalSampleLoaderManager(chainedSampleProvider)
    const soundfontManager = new GlobalSoundfontLoaderManager(chainedSoundfontProvider)
    const cloudAuthManager = CloudAuthManager.create({
        Dropbox: "jtehjzxaxf3bf1l",
        GoogleDrive: "628747153367-gt1oqcn3trr9l9a7jhigja6l1t3f1oik.apps.googleusercontent.com"
    })
    const service: StudioService = new StudioService(context, audioWorklets.value, audioDevices,
        sampleManager, soundfontManager, chainedSampleProvider, chainedSoundfontProvider,
        cloudAuthManager, buildInfo)
    StudioShortcutManager.install(service)
    if (isDefined(context.playbackStats)) {
        new BufferUnderrunDetector(context.playbackStats, service.engine)
    }
    const errorHandler = new ErrorHandler(buildInfo, () => service.recovery.createBackupCommand())
    const surface = Surface.main({
        config: (surface: Surface) => surface.own(ContextMenu.install(surface.owner, (menuItem, {clientX, clientY}) => {
            Html.unfocus(surface.owner)
            const offset = 2
            const x: number = clientX - offset
            const y: number = clientY
            const menu = Menu.create(menuItem)
            menu.moveTo(x, y)
            menu.attach(Surface.get(surface.owner).flyout)
        }))
    }, errorHandler)
    Surface.subscribeKeyboard("keydown", event => ShortcutManager.get().handleEvent(event), Number.MAX_SAFE_INTEGER)
    document.querySelector("#preloader")?.remove()
    // Resolve MŪS session if launched from the platform
    const musSession = await new MusSessionService().resolve()
    if (musSession) {
        console.debug("[boot] MŪS session resolved for user", musSession.userId)
        // If launched from a track's "Open Studio" button, create a new project
        // named after the track and import the audio into a Tape track
        if (musSession.trackTitle) {
            console.debug("[boot] Creating project from MŪS track:", musSession.trackTitle)
            service.projectProfileService.setProject(Project.new(service), musSession.trackTitle)
            // If we have an audio URL, import it into the project as a Tape track
            if (musSession.audioUrl && service.hasProfile) {
                try {
                    const project = service.project
                    const {editing, boxGraph, api} = project
                    // Resolve relative MUS URLs to absolute
                    const audioUrl = musSession.audioUrl.startsWith("http")
                        ? musSession.audioUrl
                        : `${(import.meta as any).env?.VITE_MUS_API_URL ?? "http://localhost:3000"}${musSession.audioUrl}`
                    console.debug("[boot] Importing audio from:", audioUrl)
                    // Fetch the audio bytes
                    const audioRes = await fetch(audioUrl)
                    if (!audioRes.ok) {
                        console.warn("[boot] Failed to fetch audio:", audioRes.status)
                    } else {
                        const arrayBuffer = await audioRes.arrayBuffer()
                        // Use the sample service to properly import the audio file
                        // (registers it with the sample manager and processes transients)
                        const {status, value: sample, error} = await Promises.tryCatch(
                            service.sampleService.importFile({
                                name: musSession.trackTitle,
                                arrayBuffer,
                            })
                        )
                        if (status === "rejected") {
                            console.warn("[boot] Failed to import sample:", error)
                        } else {
                            const uuid = UUID.parse(sample.uuid)
                            // Pre-load audio data so it's ready for playback
                            await Promises.tryCatch(service.sampleManager.getAudioData(uuid))
                            // Create the Tape instrument and audio file box
                            editing.modify(() => {
                                const {trackBox, instrumentBox} = api.createInstrument(InstrumentFactories.Tape)
                                instrumentBox.label.setValue(musSession.trackTitle!)
                                const audioFileBox = boxGraph.findBox<AudioFileBox>(uuid)
                                    .unwrapOrElse(() => AudioFileBox.create(boxGraph, uuid, box => {
                                        box.fileName.setValue(musSession.trackTitle!)
                                        box.startInSeconds.setValue(0)
                                        box.endInSeconds.setValue(sample.duration)
                                    }))
                                AudioContentFactory.createNotStretchedRegion({
                                    boxGraph, sample, audioFileBox, position: 0, targetTrack: trackBox
                                })
                            })
                            console.debug("[boot] Audio imported successfully, duration:", sample.duration)
                        }
                    }
                } catch (err) {
                    console.warn("[boot] Failed to import audio:", err)
                }
            }
        }
    }
    replaceChildren(surface.ground, App(service))
    AnimationFrame.start(window)
    installCursors()
    RuntimeNotifier.install({
        info: (request) => Dialogs.info(request),
        approve: (request) => Dialogs.approve({...request, reverse: true}),
        progress: (request): RuntimeNotification.ProgressUpdater => Dialogs.progress(request),
        notify: ({message, icon, origin}) => Surface.get(origin)
            .toast(message, isDefined(icon) ? IconSymbol.fromName(icon) : IconSymbol.Notification)
    })
    const opfsProbe = await Promises.tryCatch(navigator.storage.getDirectory())
    if (opfsProbe.status === "rejected") {
        Dialogs.info({
            headline: "Storage Unavailable",
            message: "openMAW cannot persist samples, presets or projects because the browser is blocking access to private storage. This typically happens in Private Browsing mode. Please reopen openMAW in a regular browser window to enable saving."
        }).finally()
    }
    if (buildInfo.env === "production" && !Browser.isLocalHost()) {
        if (import.meta.env.BUILD_UUID !== buildInfo.uuid) {
            console.warn("Cache issue:")
            console.warn("expected uuid", buildInfo.uuid)
            console.warn("embedded uuid", import.meta.env.BUILD_UUID)
            Dialogs.cache()
            return
        }
        const checkExtensions = setInterval(() => {
            if (document.scripts.length > 1) {
                Dialogs.info({
                    headline: "Warning",
                    message: "Please disable extensions to avoid undefined behavior.",
                    okText: "Ignore"
                }).finally()
                clearInterval(checkExtensions)
            }
        }, 5_000)
        const checkUpdates = setInterval(async () => {
            if (!navigator.onLine) {return}
            const {status, value: newBuildInfo} = await Promises.tryCatch(loadBuildInfo())
            if (status === "resolved" && newBuildInfo.uuid !== undefined && newBuildInfo.uuid !== buildInfo.uuid) {
                document.body.prepend(UpdateMessage())
                console.warn("A new version is online.")
                clearInterval(checkUpdates)
            }
        }, 5_000)
    } else {
        console.debug("No production checks (build version & updates).")
    }
    if (Browser.isFirefox()) {
        const persisted = await Promises.tryCatch(navigator.storage.persisted())
        console.debug("Firefox.isPersisted", persisted.value)
        if (persisted.status === "resolved" && !persisted.value) {
            await Promises.tryCatch(showStoragePersistDialog())
        }
    }
}