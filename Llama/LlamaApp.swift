import AppKit
import SwiftUI
import os.log

@main
struct LlamaApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

  var body: some Scene {
    // Empty scene, as we are a menu bar app
    Settings {
      EmptyView()
    }
    .commands {
      CommandGroup(replacing: .appSettings) {
        Button("Settings...") {
          NotificationCenter.default.post(name: .LBShowSettings, object: nil)
        }
        .keyboardShortcut(",")
      }
    }
  }
}

class AppDelegate: NSObject, NSApplicationDelegate {
  private let logger = Logger(subsystem: Logging.subsystem, category: "AppDelegate")
  private var menuController: MenuController?
  private var settingsWindowController: SettingsWindowController?
  private var recheckCLIObserver: NSObjectProtocol?

  // Deeplink (llama://) plumbing.
  // Cold-launch URL events arrive before `applicationDidFinishLaunching`, so we have
  // to register the Apple-event handler in `applicationWillFinishLaunching`. The app's
  // menu/ModelManager/alert infra isn't ready yet at that point, so the handler just
  // enqueues — the queue drains once full setup completes.
  private var pendingURLs: [URL] = []
  private var didBootstrap = false

  func applicationWillFinishLaunching(_ notification: Notification) {
    NSAppleEventManager.shared().setEventHandler(
      self,
      andSelector: #selector(handleGetURLEvent(_:withReplyEvent:)),
      forEventClass: AEEventClass(kInternetEventClass),
      andEventID: AEEventID(kAEGetURL)
    )
  }

  @MainActor
  @objc func handleGetURLEvent(
    _ event: NSAppleEventDescriptor, withReplyEvent _: NSAppleEventDescriptor
  ) {
    guard
      let str = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
      let url = URL(string: str)
    else { return }

    if didBootstrap {
      DeeplinkHandler.shared.handle(url: url)
    } else {
      pendingURLs.append(url)
    }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Carry pre-rename (LlamaBarn) settings and staging files into the new
    // (Llama) identity. Must run before anything reads settings or scans the
    // cache below (ModelManager, the server, the menu).
    RenameMigration.runIfNeeded()

    // Enable visual debugging if LB_DEBUG_UI is set
    NSView.swizzleDebugBehavior()

    logger.info("Llama starting up")

    // Configure app as menu bar only (removes from Dock)
    NSApp.setActivationPolicy(.accessory)

    // Opt into launch-at-login by default on first launch (one-time; respects a
    // later opt-out in Settings).
    LaunchAtLogin.enableOnFirstLaunch()

    // Initialize the shared model library manager to scan for existing models
    _ = ModelManager.shared

    // Create the AppKit-based status bar menu (installed models only for now)
    menuController = MenuController()

    // Initialize settings window controller (listens for LBShowSettings notifications)
    settingsWindowController = SettingsWindowController.shared

    // Ensure a usable llama binary exists, then start the server in Router Mode.
    ensureCLIThenStartServer()

    // Re-run the CLI readiness check from the menu's setup banner (retry a
    // failed install, or re-check after a `brew upgrade`).
    recheckCLIObserver = NotificationCenter.default.addObserver(
      forName: .LBRecheckCLI, object: nil, queue: .main
    ) { [weak self] _ in
      self?.ensureCLIThenStartServer()
    }
    #if DEBUG
      // Auto-open menu in debug builds to save a click
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        self?.menuController?.openMenu()
      }
    #endif

    // Drain any llama:// URLs that arrived during cold-launch before the rest
    // of the app was ready.
    didBootstrap = true
    let queued = pendingURLs
    pendingURLs.removeAll()
    for url in queued {
      DeeplinkHandler.shared.handle(url: url)
    }

    // Start the Node.js web server for the management UI (best-effort).
    // If Node.js is not installed or npm dependencies are missing, this fails
    // silently — the web UI simply won't be available, but the rest of the app
    // works normally.
    WebServerManager.shared.start()
    logger.info("Web URL: \(WebServerManager.webUrl)")

    // Start the Whisper REST endpoint for speech-to-text (best-effort).
    // Downloads the whisper model on first launch, then serves on port 8444.
    WhisperServer.shared.start()
    logger.info("Whisper REST endpoint: \(WhisperServer.baseURL)")

    logger.info("Llama startup complete")
  }

  /// Ensures a usable `llama` binary is present -- installing one if none is
  /// found -- then starts the server. Install logic lives here, at launch,
  /// rather than in `LlamaServer.start()`, which runs on every model load and
  /// settings change.
  ///
  /// For now a missing binary triggers a silent install; how this is surfaced
  /// (silent vs. a prompt) and how an outdated binary is handled are left for
  /// the install UX. If the install fails, `start()` surfaces the
  /// missing-binary error state in the menu.
  private func ensureCLIThenStartServer() {
    Task { @MainActor in
      // Installs the app-owned binary if none is found, driving the menu's
      // setup banner via LlamaInstallManager. Only start the server once a
      // binary is available; on failure the menu shows the error + retry.
      if await LlamaInstallManager.shared.ensureReady() {
        LlamaServer.shared.start()
      }
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    logger.info("Llama shutting down")

    // Gracefully stop the Node.js web server process when app quits
    WebServerManager.shared.stop()

    // Gracefully stop the Whisper REST endpoint
    WhisperServer.shared.stop()

    // Gracefully stop the llama-server process when app quits
    LlamaServer.shared.stop()

    // Clean up observers
  }
}

