import Foundation
import Network
import os.log
import SwiftWhisper
import AppKit
import AVFoundation

// MARK: - Errors

enum WhisperError: Error, LocalizedError {
  case modelNotFound
  case modelDownloadFailed(String)
  case invalidAudio(String)
  case transcriptionFailed(String)
  case serverError(String)
  case invalidRequest(String)

  var errorDescription: String? {
    switch self {
    case .modelNotFound: return "Whisper model not found"
    case .modelDownloadFailed(let reason): return "Model download failed: \(reason)"
    case .invalidAudio(let reason): return "Invalid audio: \(reason)"
    case .transcriptionFailed(let reason): return "Transcription failed: \(reason)"
    case .serverError(let reason): return "Server error: \(reason)"
    case .invalidRequest(let reason): return "Invalid request: \(reason)"
    }
  }
}

// MARK: - Whisper REST Server

/// A lightweight HTTP REST server that serves speech-to-text via SwiftWhisper
/// on port 8444 with full CORS support.
@MainActor
final class WhisperServer {
  static let shared = WhisperServer()

  /// The port the whisper REST endpoint listens on.
  nonisolated static let port: UInt16 = 8444

  private var listener: NWListener?
  private var whisper: Whisper?
  private var isModelReady = false
  private var modelDownloadTask: Task<Void, Never>?
  private let logger = Logger(subsystem: Logging.subsystem, category: "WhisperServer")
  private var isRunning = false

  /// The URL where the whisper REST API is available.
  nonisolated static var baseURL: String { "http://localhost:\(port)" }

  // MARK: - Model paths

  /// Directory where the whisper model is cached.
  private static var modelDirectory: URL {
    UserSettings.appSupportDir.appendingPathComponent("whisper", isDirectory: true)
  }

  /// The URL of the whisper model file.
  private static var modelFileURL: URL {
    modelDirectory.appendingPathComponent("ggml-base.en.bin")
  }

  /// The remote URL to download the whisper model from (Hugging Face).
  private static let remoteModelURL = URL(
    string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
  )!

  // MARK: - Start / Stop

  func start() {
    guard !isRunning else { return }
    isRunning = true

    // Ensure model directory exists
    try? FileManager.default.createDirectory(
      at: Self.modelDirectory, withIntermediateDirectories: true
    )

    // Start model preparation in background
    modelDownloadTask = Task { [weak self] in
      guard let self = self else { return }
      await self.prepareModel()
    }

    startListener()
    logger.info("Whisper REST endpoint starting on port \(Self.port)")
  }

  func stop() {
    isRunning = false
    modelDownloadTask?.cancel()
    modelDownloadTask = nil
    listener?.cancel()
    listener = nil
    whisper = nil
    isModelReady = false
    logger.info("Whisper REST endpoint stopped")
  }

  var isReady: Bool { isModelReady && isRunning }

  // MARK: - Model Preparation

  private func prepareModel() async {
    let modelPath = Self.modelFileURL

    if FileManager.default.fileExists(atPath: modelPath.path) {
      logger.info("Whisper model found at \(modelPath.path)")
      loadModel(at: modelPath)
      return
    }

    logger.info("Whisper model not cached. Downloading from Hugging Face (~140MB)...")
    let success = await downloadModel(to: modelPath)

    if success {
      logger.info("Whisper model downloaded successfully")
      loadModel(at: modelPath)
    } else {
      logger.error("Failed to download whisper model")
    }
  }

  private func downloadModel(to destination: URL) async -> Bool {
    do {
      let (tempURL, response) = try await URLSession.shared.download(from: Self.remoteModelURL)

      guard let httpResponse = response as? HTTPURLResponse,
            httpResponse.statusCode == 200
      else {
        logger.error("Model download failed with status \((response as? HTTPURLResponse)?.statusCode ?? -1)")
        return false
      }

      // Move downloaded file to destination
      if FileManager.default.fileExists(atPath: destination.path) {
        try FileManager.default.removeItem(at: destination)
      }
      try FileManager.default.moveItem(at: tempURL, to: destination)
      return true
    } catch {
      logger.error("Model download error: \(error.localizedDescription)")
      return false
    }
  }

  private func loadModel(at url: URL) {
    whisper = Whisper(fromFileURL: url)
    isModelReady = true
    logger.info("SwiftWhisper model loaded successfully")
  }

  // MARK: - Network Listener

  private func startListener() {
    let params = NWParameters.tcp
    // Allow reuse of the address so the server can restart quickly
    params.allowLocalEndpointReuse = true

    guard let listener = try? NWListener(using: params, on: NWEndpoint.Port(rawValue: Self.port)!) else {
      logger.error("Failed to create NWListener on port \(Self.port)")
      return
    }

    self.listener = listener
    listener.stateUpdateHandler = { [weak self] state in
      guard let self = self else { return }
      switch state {
      case .ready:
        self.logger.info("Whisper server listening on port \(Self.port)")
      case .failed(let error):
        self.logger.error("Whisper server failed: \(error.localizedDescription)")
      case .cancelled:
        self.logger.info("Whisper server cancelled")
      default:
        break
      }
    }

    listener.newConnectionHandler = { [weak self] connection in
      guard let self = self else {
        connection.cancel()
        return
      }
      Task { @MainActor in
        self.handleConnection(connection)
      }
    }

    listener.start(queue: .main)
  }

  // MARK: - Connection Handling

  private func handleConnection(_ connection: NWConnection) {
    connection.start(queue: .main)

    // Accumulate data until we have a complete HTTP request
    var buffer = Data()

    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) {
      [weak self] data, _, isComplete, error in
      guard let self = self else {
        connection.cancel()
        return
      }
      Task { @MainActor in
        if let error = error {
          self.logger.error("Connection error: \(error.localizedDescription)")
          connection.cancel()
          return
        }

        if let data = data, !data.isEmpty {
          buffer.append(data)
        }

        if isComplete || data == nil || data!.isEmpty {
          self.handleHTTPRequest(buffer, on: connection)
        } else {
          self.continueReceiving(on: connection, accumulated: buffer)
        }
      }
    }
  }

  /// Per-connection state to avoid inout capture in escaping closures.
  private class ConnectionState {
    var buffer = Data()
  }

  /// Key-value store mapping connection IDs to their buffer state.
  private var connectionStates = [ObjectIdentifier: ConnectionState]()

  private func state(for connection: NWConnection) -> ConnectionState {
    let id = ObjectIdentifier(connection)
    if let existing = connectionStates[id] { return existing }
    let new = ConnectionState()
    connectionStates[id] = new
    return new
  }

  private func cleanupState(for connection: NWConnection) {
    connectionStates.removeValue(forKey: ObjectIdentifier(connection))
  }

  private func continueReceiving(on connection: NWConnection, accumulated: Data) {
    let st = state(for: connection)
    st.buffer = accumulated

    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) {
      [weak self] data, _, isComplete, error in
      guard let self = self else {
        connection.cancel()
        return
      }
      Task { @MainActor in
        let st = self.state(for: connection)

        if let error = error {
          self.logger.error("Connection receive error: \(error.localizedDescription)")
          self.sendErrorResponse(connection, status: 500, message: "Internal server error")
          return
        }

        if let data = data, !data.isEmpty {
          st.buffer.append(data)
        }

        if isComplete || data == nil || data!.isEmpty {
          self.handleHTTPRequest(st.buffer, on: connection)
          self.cleanupState(for: connection)
        } else {
          self.continueReceiving(on: connection, accumulated: st.buffer)
        }
      }
    }
  }

  // MARK: - HTTP Parsing

  private struct HTTPRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data
  }

  private func parseHTTPRequest(_ data: Data) -> HTTPRequest? {
    guard let headerEnd = data.firstRange(of: Data("\r\n\r\n".utf8)) else { return nil }

    let headerData = data[data.startIndex..<headerEnd.upperBound]
    let bodyStart = headerEnd.upperBound
    let body = bodyStart < data.endIndex ? Data(data[bodyStart...]) : Data()

    guard let headerString = String(data: headerData, encoding: .utf8) else { return nil }

    var lines = headerString.components(separatedBy: "\r\n")
    guard !lines.isEmpty else { return nil }

    // Parse request line: "METHOD /path HTTP/1.1"
    let requestParts = lines.removeFirst().components(separatedBy: " ")
    guard requestParts.count >= 2 else { return nil }

    let method = requestParts[0]
    let path = requestParts[1]

    // Parse headers
    var headers: [String: String] = [:]
    for line in lines {
      let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
      if parts.count == 2 {
        let key = parts[0].trimmingCharacters(in: .whitespaces)
        let value = parts[1].trimmingCharacters(in: .whitespaces)
        headers[key.lowercased()] = value
      }
    }

    return HTTPRequest(method: method, path: path, headers: headers, body: body)
  }

  // MARK: - Request Routing

  private func handleHTTPRequest(_ data: Data, on connection: NWConnection) {
    guard let request = parseHTTPRequest(data) else {
      sendErrorResponse(connection, status: 400, message: "Bad request")
      return
    }

    switch (request.method, request.path) {
    case ("GET", "/health"):
      handleHealth(on: connection)
    case ("POST", "/transcribe"):
      handleTranscribe(request, on: connection)
    case ("POST", "/tts"):
      handleTTS(request, on: connection)
    case ("OPTIONS", _):
      handleCORSPreflight(request, on: connection)
    default:
      sendErrorResponse(connection, status: 404, message: "Not found")
    }
  }

  // MARK: - Endpoint Handlers

  private func handleHealth(on connection: NWConnection) {
    let body = try? JSONSerialization.data(withJSONObject: [
      "status": isModelReady ? "ready" : "loading",
      "modelReady": isModelReady,
      "modelLoading": !isModelReady && modelDownloadTask != nil,
    ])
    sendJSONResponse(connection, status: 200, body: body ?? Data())
  }

  private func handleTranscribe(_ request: HTTPRequest, on connection: NWConnection) {
    guard isModelReady, let whisper = whisper else {
      sendErrorResponse(connection, status: 503, message: "Model not ready")
      return
    }

    // Parse JSON body
    guard let bodyDict = try? JSONSerialization.jsonObject(with: request.body) as? [String: Any],
          let audioBase64 = bodyDict["audio"] as? String
    else {
      sendErrorResponse(connection, status: 400, message: "Request body must have 'audio' field with base64-encoded WAV data")
      return
    }

    // Decode base64
    guard let audioData = Data(base64Encoded: audioBase64) else {
      sendErrorResponse(connection, status: 400, message: "Invalid base64 audio data")
      return
    }

    // Parse WAV and extract PCM samples
    let pcmSamples: [Float]
    do {
      pcmSamples = try Self.decodeWAVToPCM(audioData)
    } catch {
      sendErrorResponse(connection, status: 400, message: "Invalid audio: \(error.localizedDescription)")
      return
    }

    // Transcribe on a background queue (SwiftWhisper is blocking)
    Task {
      do {
        let segments = try await whisper.transcribe(audioFrames: pcmSamples)

        // Build response
        let fullText = segments.map(\.text).joined(separator: " ")
        let segmentArray: [[String: Any]] = segments.map { seg in
          [
            "start": seg.startTime,
            "end": seg.endTime,
            "text": seg.text,
          ]
        }

        let responseBody: [String: Any] = [
          "text": fullText,
          "segments": segmentArray,
        ]

        let jsonData = try JSONSerialization.data(withJSONObject: responseBody)
        self.sendJSONResponse(connection, status: 200, body: jsonData)
      } catch {
        self.sendErrorResponse(connection, status: 500, message: "Transcription failed: \(error.localizedDescription)")
      }
    }
  }

  private func handleCORSPreflight(_ request: HTTPRequest, on connection: NWConnection) {
    sendCORSHeaders(connection)
    sendEmptyBody(connection, status: 204)
  }

  // MARK: - TTS

  private func handleTTS(_ request: HTTPRequest, on connection: NWConnection) {
    guard let bodyDict = try? JSONSerialization.jsonObject(with: request.body) as? [String: Any],
          let text = bodyDict["text"] as? String, !text.isEmpty
    else {
      sendErrorResponse(connection, status: 400, message: "Request body must have 'text' field with non-empty string")
      return
    }

    let voiceID = bodyDict["voice"] as? String

    Task {
      do {
        let (audioBase64, duration, usedVoice) = try await Self.generateTTS(text, voice: voiceID)
        let responseBody: [String: Any] = [
          "audio": audioBase64,
          "duration": duration,
          "text": text,
          "voice": usedVoice,
        ]
        let jsonData = try JSONSerialization.data(withJSONObject: responseBody)
        self.sendJSONResponse(connection, status: 200, body: jsonData)
      } catch {
        self.sendErrorResponse(connection, status: 500, message: "TTS failed: \(error.localizedDescription)")
      }
    }
  }

  // MARK: - TTS Generation

  /// Generates speech audio from text using the system speech synthesizer.
  /// Returns (base64Wav, durationSeconds, voiceName).
  private static func generateTTS(_ text: String, voice voiceID: String?) async throws -> (String, Double, String) {
    let aiffURL = FileManager.default.temporaryDirectory.appendingPathComponent("tts_\(UUID().uuidString).aiff")
    let wavURL = FileManager.default.temporaryDirectory.appendingPathComponent("tts_\(UUID().uuidString).wav")

    defer {
      try? FileManager.default.removeItem(at: aiffURL)
      try? FileManager.default.removeItem(at: wavURL)
    }

    let synth: NSSpeechSynthesizer
    if let vid = voiceID {
      let voiceName = NSSpeechSynthesizer.VoiceName(rawValue: vid)
      guard let s = NSSpeechSynthesizer(voice: voiceName) else {
        throw WhisperError.serverError("Failed to create speech synthesizer with voice: \(vid)")
      }
      synth = s
    } else {
      synth = NSSpeechSynthesizer()
    }

    return try await withCheckedThrowingContinuation { continuation in
      let delegate = TTSDelegate(synth: synth, aiffURL: aiffURL, wavURL: wavURL) { result in
        continuation.resume(with: result)
      }
      synth.delegate = delegate
      synth.startSpeaking(text, to: aiffURL)
    }
  }
}

// MARK: - TTS Delegate

/// Retained by NSSpeechSynthesizer during speech; converts AIFF to WAV on completion.
private class TTSDelegate: NSObject, NSSpeechSynthesizerDelegate {
  private let synth: NSSpeechSynthesizer
  private let aiffURL: URL
  private let wavURL: URL
  private let completion: (Result<(String, Double, String), Error>) -> Void

  init(
    synth: NSSpeechSynthesizer,
    aiffURL: URL,
    wavURL: URL,
    completion: @escaping (Result<(String, Double, String), Error>) -> Void
  ) {
    self.synth = synth
    self.aiffURL = aiffURL
    self.wavURL = wavURL
    self.completion = completion
  }

  func speechSynthesizer(_ sender: NSSpeechSynthesizer, didFinishSpeaking finishedSpeaking: Bool) {
    do {
      let aiffFile = try AVAudioFile(forReading: aiffURL)
      let format = aiffFile.processingFormat
      let frameCount = AVAudioFrameCount(aiffFile.length)
      let wavFile = try AVAudioFile(
        forWriting: wavURL,
        settings: format.settings,
        commonFormat: AVAudioCommonFormat.pcmFormatInt16,
        interleaved: true
      )

      guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
        completion(.failure(WhisperError.serverError("Failed to create PCM buffer")))
        return
      }

      try aiffFile.read(into: buffer)
      try wavFile.write(from: buffer)

      let wavData = try Data(contentsOf: wavURL)
      let audioBase64 = wavData.base64EncodedString()
      let duration = Double(aiffFile.length) / format.sampleRate
      let voiceName = synth.voice()?.rawValue ?? "default"

      completion(.success((audioBase64, duration, voiceName)))
    } catch {
      completion(.failure(error))
    }
  }

  func speechSynthesizer(_ sender: NSSpeechSynthesizer, didEncounterErrorAt characterIndex: Int, of string: String, message: String) {
    completion(.failure(WhisperError.serverError(message)))
  }
}

extension WhisperServer {
  // MARK: - WAV Decoding (mono, 16-bit PCM) into Float samples normalized to [-1, 1].
  /// The whisper model expects 16kHz mono audio.
  static func decodeWAVToPCM(_ data: Data) throws -> [Float] {
    guard data.count > 44 else { throw WhisperError.invalidAudio("File too small to be WAV") }

    let stream = UnsafeMutableRawPointer.allocate(byteCount: data.count, alignment: 1)
    defer { stream.deallocate() }
    data.copyBytes(to: stream.assumingMemoryBound(to: UInt8.self), count: data.count)

    // Parse WAV header
    let riff = String(bytes: data[0..<4], encoding: .ascii) ?? ""
    let wave = String(bytes: data[8..<12], encoding: .ascii) ?? ""
    guard riff == "RIFF", wave == "WAVE" else {
      throw WhisperError.invalidAudio("Not a valid WAV file")
    }

    // Find fmt chunk
    var fmtStart = 12
    while fmtStart + 8 < data.count {
      let chunkID = String(bytes: data[fmtStart..<fmtStart+4], encoding: .ascii) ?? ""
      let chunkSize = Int(data[fmtStart+4..<fmtStart+8].withUnsafeBytes { $0.load(as: UInt32.self) })

      if chunkID == "fmt " {
        guard fmtStart + 24 <= data.count else {
          throw WhisperError.invalidAudio("Truncated fmt chunk")
        }

        let audioFormat = Int(data[fmtStart+8..<fmtStart+10].withUnsafeBytes { $0.load(as: UInt16.self) })
        let numChannels = Int(data[fmtStart+10..<fmtStart+12].withUnsafeBytes { $0.load(as: UInt16.self) })
        let sampleRate = Int(data[fmtStart+12..<fmtStart+16].withUnsafeBytes { $0.load(as: UInt32.self) })
        let bitsPerSample = Int(data[fmtStart+22..<fmtStart+24].withUnsafeBytes { $0.load(as: UInt16.self) })

        guard audioFormat == 1 else { // PCM
          throw WhisperError.invalidAudio("Only PCM WAV files are supported (format=\(audioFormat))")
        }
        guard bitsPerSample == 16 else {
          throw WhisperError.invalidAudio("Only 16-bit WAV files are supported (got \(bitsPerSample) bits)")
        }

        // Find data chunk
        var dataStart = fmtStart + 8 + chunkSize
        // Align to even boundary
        if dataStart % 2 != 0 { dataStart += 1 }

        while dataStart + 8 <= data.count {
          let dataChunkID = String(bytes: data[dataStart..<dataStart+4], encoding: .ascii) ?? ""
          let dataChunkSize = Int(data[dataStart+4..<dataStart+8].withUnsafeBytes { $0.load(as: UInt32.self) })

          if dataChunkID == "data" {
            let sampleDataStart = dataStart + 8
            let sampleBytesCount = min(dataChunkSize, data.count - sampleDataStart)
            let sampleCount = sampleBytesCount / (bitsPerSample / 8)

            guard sampleCount > 0 else {
              throw WhisperError.invalidAudio("No audio samples found")
            }

            // Read samples from the appropriate channel
            let bytesPerFrame = numChannels * (bitsPerSample / 8)
            var samples: [Float] = []
            samples.reserveCapacity(sampleCount / numChannels)

            for i in 0..<(sampleCount / numChannels) {
              let frameStart = sampleDataStart + i * bytesPerFrame
              let sampleValue = data[frameStart..<frameStart+2].withUnsafeBytes { $0.load(as: Int16.self) }
              // Convert to Float normalized to [-1, 1]
              samples.append(Float(sampleValue) / 32768.0)
            }

            // Resample if necessary (whisper.cpp expects 16kHz)
            if sampleRate != 16000 {
              samples = Self.resample(samples, from: sampleRate, to: 16000)
            }

            return samples
          }

          dataStart += 8 + dataChunkSize
          if dataStart % 2 != 0 { dataStart += 1 }
        }

        throw WhisperError.invalidAudio("No data chunk found in WAV file")
      }

      fmtStart += 8 + chunkSize
      if fmtStart % 2 != 0 { fmtStart += 1 }
    }

    throw WhisperError.invalidAudio("No fmt chunk found in WAV file")
  }

  /// Simple linear resampling. Not optimal but good enough for speech input.
  private static func resample(_ samples: [Float], from srcRate: Int, to dstRate: Int) -> [Float] {
    guard srcRate != dstRate else { return samples }
    let ratio = Double(dstRate) / Double(srcRate)
    let outCount = Int(Double(samples.count) * ratio)
    var out: [Float] = []
    out.reserveCapacity(outCount)

    for i in 0..<outCount {
      let srcIndex = Double(i) / ratio
      let left = Int(srcIndex)
      let right = min(left + 1, samples.count - 1)
      let frac = Float(srcIndex - Double(left))
      // Linear interpolation
      out.append(samples[left] * (1 - frac) + samples[right] * frac)
    }

    return out
  }

  // MARK: - HTTP Response Helpers

  private func corsHeaders() -> [(String, String)] {
    [
      ("Access-Control-Allow-Origin", "*"),
      ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
      ("Access-Control-Allow-Headers", "Content-Type, Authorization"),
      ("Access-Control-Max-Age", "3600"),
    ]
  }

  private func sendJSONResponse(_ connection: NWConnection, status: Int, body: Data) {
    let statusText = status == 200 ? "OK" : (status == 204 ? "No Content" : (status == 400 ? "Bad Request" : (status == 404 ? "Not Found" : (status == 503 ? "Service Unavailable" : "Error"))))

    var header = "HTTP/1.1 \(status) \(statusText)\r\n"
    header += "Content-Type: application/json\r\n"
    header += "Content-Length: \(body.count)\r\n"
    header += "Connection: close\r\n"
    for (key, value) in corsHeaders() {
      header += "\(key): \(value)\r\n"
    }
    header += "\r\n"

    var responseData = Data(header.utf8)
    responseData.append(body)

    connection.send(content: responseData, completion: .contentProcessed({ _ in
      connection.cancel()
    }))
  }

  private func sendErrorResponse(_ connection: NWConnection, status: Int, message: String) {
    let body = try? JSONSerialization.data(withJSONObject: ["error": message])
    sendJSONResponse(connection, status: status, body: body ?? Data())
  }

  private func sendCORSHeaders(_ connection: NWConnection) {
    // Just used for preflight; actual response is handled in sendEmptyBody
  }

  private func sendEmptyBody(_ connection: NWConnection, status: Int) {
    let statusText = status == 204 ? "No Content" : "OK"
    var header = "HTTP/1.1 \(status) \(statusText)\r\n"
    header += "Content-Length: 0\r\n"
    header += "Connection: close\r\n"
    for (key, value) in corsHeaders() {
      header += "\(key): \(value)\r\n"
    }
    header += "\r\n"

    connection.send(content: Data(header.utf8), completion: .contentProcessed({ _ in
      connection.cancel()
    }))
  }
}
