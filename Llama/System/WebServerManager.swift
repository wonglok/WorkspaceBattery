import Foundation
import os.log

/// Manages the Bun web server process lifecycle.
///
/// The web server provides a management UI and API proxy for llama-server.
/// It runs as a child process alongside the app and is managed independently
/// of the llama-server (it can be started/stopped separately).
///
/// The Bun runtime is bundled in the app as `Resources/bun`. During
/// development (when running from Xcode or the source tree), the manager
/// falls back to the system-installed Bun if the bundled binary is
/// not available at the expected path.
@MainActor
class WebServerManager {
  static let shared = WebServerManager()

  /// Default port for the web server.
  nonisolated static let defaultPort = 8333

  /// The port the web server listens on.
  nonisolated static var port: Int { UserSettings.webServerPort ?? defaultPort }

  /// The bundled Bun binary, or nil if not found.
  /// Search order:
  ///   1. App bundle Resources (production: Llama.app/Contents/Resources/bun)
  ///   2. Source tree web/bin/bun (development)
  ///   3. System PATH `which bun` (fallback)
  private var bundledBunPath: URL? {
    // 1. Check app bundle Resources
    if let resource = Bundle.main.url(forResource: "bun", withExtension: nil),
      FileManager.default.isExecutableFile(atPath: resource.path)
    {
      return resource
    }

    // 2. Check web/bin/bun next to the project (development from Xcode)
    let srcPath = webDir.appendingPathComponent("bin/bun")
    if FileManager.default.isExecutableFile(atPath: srcPath.path) {
      return srcPath
    }

    // 3. Fallback: check PATH
    let which = Process()
    which.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    which.arguments = ["which", "bun"]
    let outPipe = Pipe()
    which.standardOutput = outPipe
    which.standardError = Pipe()
    guard (try? which.run()) != nil else { return nil }
    which.waitUntilExit()
    guard which.terminationStatus == 0 else { return nil }

    let path = String(
      decoding: outPipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self
    ).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !path.isEmpty else { return nil }
    let url = URL(fileURLWithPath: path)
    return FileManager.default.isExecutableFile(atPath: url.path) ? url : nil
  }

  private var process: Process?
  private var outputPipe: Pipe?
  private let logger = Logger(subsystem: Logging.subsystem, category: "WebServer")
  private let webDir: URL

  enum ServerState: Equatable {
    case idle
    case starting
    case running
    case error(String)
  }

  var state: ServerState = .idle {
    didSet { NotificationCenter.default.post(name: .LBWebServerStateDidChange, object: self) }
  }

  private init() {
    // The web directory (server.ts, public/, node_modules) — try several locations
    // depending on whether we're running from the app bundle or from source.

    let candidates: [URL?] = [
      // 1. Bundled in app Resources/ (production)
      Bundle.main.resourceURL?.appendingPathComponent("web"),
      // 2. Inside Llama.app bundle at Contents/web/ (alternative layout)
      Bundle.main.bundleURL
        .deletingLastPathComponent()  // /Contents
        .deletingLastPathComponent()  // /Llama.app
        .appendingPathComponent("web"),
      // 3. Next to the source tree (development: Llama-macOS/web/)
      URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        .appendingPathComponent("web"),
      // 4. Walk up from the executable path
    ]

    var found: URL?
    for candidate in candidates {
      guard let candidate else { continue }
      let testPath = candidate.appendingPathComponent("server.ts").path
      if FileManager.default.fileExists(atPath: testPath) {
        found = candidate
        break
      }
    }

    // Last resort: walk up from the executable directory
    if found == nil {
      var candidate = Bundle.main.executableURL?.deletingLastPathComponent()
      while let dir = candidate, dir.path != "/" {
        let testDir = dir.appendingPathComponent("web")
        if FileManager.default.fileExists(atPath: testDir.appendingPathComponent("server.ts").path) {
          found = testDir
          break
        }
        candidate = dir.deletingLastPathComponent()
      }
    }

    webDir = found ?? URL(fileURLWithPath: "../web").standardized
  }

  /// Returns the path to the web directory.
  var webDirectory: URL { webDir }

  /// Whether the Bun web server is currently running.
  var isRunning: Bool { process != nil && process!.isRunning }

  /// Starts the Bun web server as a child process.
  /// Returns immediately; the server starts asynchronously.
  func start() {
    guard process == nil || !process!.isRunning else {
      logger.info("Web server already running")
      return
    }

    guard let bunPath = bundledBunPath else {
      let msg = "Bun not found. Install Bun (>=1.0) to use the web UI, or run `scripts/download-bun.sh` to bundle it."
      logger.error("\(msg)")
      state = .error(msg)
      return
    }

    // Verify the web directory exists and has server.ts
    let serverPath = webDir.appendingPathComponent("server.ts").path
    guard FileManager.default.fileExists(atPath: serverPath) else {
      let msg = "Web server file not found at \(serverPath)"
      logger.error("\(msg)")
      state = .error(msg)
      return
    }

    // Verify node_modules exist
    let nodeModulesPath = webDir.appendingPathComponent("node_modules").path
    guard FileManager.default.fileExists(atPath: nodeModulesPath) else {
      let msg = "Bun dependencies not installed. Run `bun install` in the web/ directory."
      logger.error("\(msg)")
      state = .error(msg)
      return
    }

    state = .starting
    logger.info("Starting web server from \(self.webDir.path) using \(bunPath.path) on port \(Self.port)")

    let proc = Process()
    proc.executableURL = bunPath
    proc.arguments = [
      "run", serverPath,
      "--port", String(Self.port),
    ]
    proc.currentDirectoryURL = webDir

    // Set up env vars
    var env = ProcessInfo.processInfo.environment
    env["PORT"] = String(Self.port)
    proc.environment = env

    // Capture stdout
    let outPipe = Pipe()
    proc.standardOutput = outPipe
    proc.standardError = Pipe()
    outputPipe = outPipe

    // Read output asynchronously
    outPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty, let output = String(data: data, encoding: .utf8) else { return }
      let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else { return }
      self?.logger.info("\(trimmed, privacy: .public)")
    }

    // Termination handler
    proc.terminationHandler = { [weak self] _ in
      Task { @MainActor in
        guard let self = self, self.state != .idle else { return }
        self.cleanup()
        self.state = .error("Web server exited unexpectedly")
      }
    }

    do {
      try proc.run()
      self.process = proc
      logger.info("Web server started (pid: \(proc.processIdentifier))")
    } catch {
      logger.error("Failed to start web server: \(error.localizedDescription)")
      state = .error(error.localizedDescription)
      cleanup()
      return
    }

    // After a brief wait, check if the server is actually responding
    Task { [weak self] in
      try? await Task.sleep(nanoseconds: 2_000_000_000) // 2s
      await MainActor.run {
        guard let self = self, self.state == .starting else { return }

        // Quick health check
        let semaphore = DispatchSemaphore(value: 0)
        var isHealthy = false
        let checkUrl = URL(string: "http://localhost:\(Self.port)/api/status")!

        URLSession.shared.dataTask(with: checkUrl) { data, resp, error in
          if let httpResp = resp as? HTTPURLResponse, httpResp.statusCode == 200 {
            isHealthy = true
          }
          semaphore.signal()
        }.resume()

        _ = semaphore.wait(timeout: .now() + 3.0)

        if isHealthy {
          self.state = .running
          self.logger.info("Web server is healthy on port \(Self.port)")
        } else {
          self.logger.warning("Web server started but health check failed")
          self.state = .running // optimistically mark as running
        }
      }
    }
  }

  /// Stops the web server.
  func stop() {
    guard let proc = process, proc.isRunning else { return }

    logger.info("Stopping web server")
    state = .idle
    proc.terminate()

    // Force kill after a timeout
    DispatchQueue.global().asyncAfter(deadline: .now() + 2.0) { [weak self] in
      guard let self = self, let proc = self.process, proc.isRunning else { return }
      kill(proc.processIdentifier, SIGKILL)
    }

    proc.waitUntilExit()
    cleanup()
  }

  /// Restarts the web server.
  func restart() {
    stop()
    start()
  }

  /// Returns the URL for the web UI.
  nonisolated static var webUrl: String {
    "http://localhost:\(port)"
  }

  // MARK: - Private

  private func cleanup() {
    outputPipe?.fileHandleForReading.readabilityHandler = nil
    try? outputPipe?.fileHandleForReading.close()
    outputPipe = nil
    process = nil
  }
}
